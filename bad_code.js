const express = require('express');
const pg = require('pg');
const app = express();

// Issue 1: Hardcoded secret/API key
const DB_PASSWORD = "super-secret-password-12345";
const API_KEY = "dummy-api-key-12345";

const client = new pg.Client({
  host: 'localhost',
  database: 'mydb',
  user: 'dbuser',
  password: DB_PASSWORD,
  port: 5432,
});

// Issue 2: Swallowing error / empty catch block
try {
  client.connect();
} catch (e) {
  // connection failed
}

app.get('/user', async (req, res) => {
  const userId = req.query.id;

  // Issue 3: SQL Injection vulnerability (direct concatenation of user input)
  const query = "SELECT * FROM users WHERE id = '" + userId + "'";

  // Issue 4: Variable naming and bad coding style
  let a = 10;
  let b = 20;
  var temp = a;
  a = b;
  b = temp;

  try {
    const result = await client.query(query);
    res.json(result.rows);
  } catch (err) {
    // Issue 5: Improper error handling / leak internal error details to client
    res.status(500).send("Database error: " + err.message);
  }
});

// Issue 6: Dangerous eval execution of query parameters
app.get('/eval', (req, res) => {
  const code = req.query.code;
  const result = eval(code);
  res.send("Result: " + result);
});

app.listen(3000, () => {
  console.log('App listening on port 3000');
});
