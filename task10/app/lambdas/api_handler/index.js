const AWS = require("aws-sdk");
const uuid = require("uuid");

const cognito = new AWS.CognitoIdentityServiceProvider();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const USER_POOL_ID = process.env.cognito_id;
const TABLES_TABLE_NAME = process.env.tables_table;
const RESERVATIONS_TABLE_NAME = process.env.reservations_table;
const CLIENT_ID = process.env.cognito_client_id;

exports.handler = async (event) => {
  const { httpMethod, path } = event;

  if (httpMethod === "POST" && path === "/signup") {
    return handleSignUp(event);
  } else if (httpMethod === "POST" && path === "/signin") {
    return handleSignIn(event);
  } else if (httpMethod === "GET" && path === "/tables") {
    return handleGetTables();
  } else if (httpMethod === "POST" && path === "/tables") {
    return handleCreateTable(event);
  } else if (httpMethod === "GET" && path.startsWith("/tables/")) {
    const tableId = path.split("/")[2];
    return handleGetTableById(tableId);
  } else if (httpMethod === "POST" && path === "/reservations") {
    return handleCreateReservation(event);
  } else if (httpMethod === "GET" && path === "/reservations") {
    return handleGetReservations();
  } else {
    return createResponse(400, { message: "Invalid route" });
  }
};

async function handleSignUp(event) {
    const { firstName, lastName, email, password } = JSON.parse(event.body);
  
    const listUsersParams = {
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${email}"`,
    };
  
    try {
      const existingUsers = await cognito.listUsers(listUsersParams).promise();
      if (existingUsers.Users.length > 0) {
        return createResponse(200, { message: "User already exists" });
      }
  
      const params = {
        UserPoolId: USER_POOL_ID,
        Username: email,
        TemporaryPassword: password,
        UserAttributes: [{ Name: "email", Value: email }],
        MessageAction: "SUPPRESS",
      };
  
      await cognito.adminCreateUser(params).promise();
  
      const passwordParams = {
        Password: password,
        UserPoolId: USER_POOL_ID,
        Username: email,
        Permanent: true,
      };
      await cognito.adminSetUserPassword(passwordParams).promise();
      return createResponse(200, { message: "User created successfully" });
    } catch (error) {
      console.error(error);
      return createResponse(400, { message: error.message });
    }
  }

async function handleSignIn(event) {
  const { email, password } = JSON.parse(event.body);

  const params = {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  };

  try {
    const response = await cognito.initiateAuth(params).promise();
    const idToken = response.AuthenticationResult.IdToken;
    return createResponse(200, { accessToken: idToken });
  } catch (error) {
    console.error(error);
    return createResponse(400, { message: error.message });
  }
}

async function handleGetTables() {
  try {
    const params = {
      TableName: TABLES_TABLE_NAME,
    };
    const data = await dynamoDB.scan(params).promise();
    return createResponse(200, { tables: data.Items });
  } catch (error) {
    console.error(error);
    return createResponse(400, { message: error.message });
  }
}

async function handleCreateTable(event) {
  const { id, number, places, isVip, minOrder } = JSON.parse(event.body);

  const params = {
    TableName: TABLES_TABLE_NAME,
    Item: {
      id: id,
      number: number,
      places: places,
      isVip: isVip,
      minOrder: minOrder || null,
    },
  };

  try {
    await dynamoDB.put(params).promise();
    return createResponse(200, { id: id });
  } catch (error) {
    console.error(error);
    return createResponse(400, { message: error.message });
  }
}

async function handleGetTableById(tableId) {
  const params = {
    TableName: TABLES_TABLE_NAME,
    Key: {
      id: parseInt(tableId, 10),
    },
  };

  try {
    const data = await dynamoDB.get(params).promise();
    if (!data.Item) {
      return createResponse(400, { message: "Table not found" });
    }
    return createResponse(200, data.Item);
  } catch (error) {
    console.error(error);
    return createResponse(400, { message: error.message });
  }
}

async function handleCreateReservation(event) {
  const {
    tableNumber,
    clientName,
    phoneNumber,
    date,
    slotTimeStart,
    slotTimeEnd,
  } = JSON.parse(event.body);

  // Check if the table exists
  const tableExistsParams = {
    TableName: TABLES_TABLE_NAME,
    FilterExpression: "#num = :tableNumber",
    ExpressionAttributeNames: {
      "#num": "number", // Use placeholder to avoid reserved keyword
    },
    ExpressionAttributeValues: {
      ":tableNumber": tableNumber,
    },
  };

  try {
    const tableExistsResult = await dynamoDB.scan(tableExistsParams).promise();
    if (tableExistsResult.Items.length === 0) {
      return createResponse(400, { message: "Table does not exist" });
    }

    // Check for overlapping reservations
    const overlapParams = {
      TableName: RESERVATIONS_TABLE_NAME,
      FilterExpression:
        "#num = :tableNumber AND #date = :date AND slotTimeStart <= :slotTimeEnd AND slotTimeEnd >= :slotTimeStart",
      ExpressionAttributeNames: {
        "#num": "tableNumber",
        "#date": "date",
      },
      ExpressionAttributeValues: {
        ":tableNumber": tableNumber,
        ":date": date,
        ":slotTimeStart": slotTimeStart,
        ":slotTimeEnd": slotTimeEnd,
      },
    };

    const overlapResult = await dynamoDB.scan(overlapParams).promise();
    if (overlapResult.Items.length > 0) {
      return createResponse(400, {
        message: "Reservation overlaps with an existing one",
      });
    }

    // Create the reservation if all checks pass
    const reservationId = uuid.v4();

    const createReservationParams = {
      TableName: RESERVATIONS_TABLE_NAME,
      Item: {
        id: reservationId,
        tableNumber: tableNumber,
        clientName: clientName,
        phoneNumber: phoneNumber,
        date: date,
        slotTimeStart: slotTimeStart,
        slotTimeEnd: slotTimeEnd,
      },
    };

    await dynamoDB.put(createReservationParams).promise();
    return createResponse(200, { reservationId: reservationId });
  } catch (error) {
    console.error(error);
    return createResponse(400, { message: error.message });
  }
}

async function handleGetReservations() {
  try {
    const params = {
      TableName: RESERVATIONS_TABLE_NAME,
    };
    const data = await dynamoDB.scan(params).promise();
    return createResponse(200, { reservations: data.Items });
  } catch (error) {
    console.error(error);
    return createResponse(400, { message: error.message });
  }
}

function createResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}