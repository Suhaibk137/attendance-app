// Import required modules
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const basicAuth = require('express-basic-auth');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const os = require('os');
const moment = require('moment-timezone'); // Added moment-timezone

// Initialize the app
const app = express();

// Set up middleware
app.use(bodyParser.urlencoded({ extended: false })); // Parse URL-encoded bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory
app.set('view engine', 'ejs'); // Set EJS as the templating engine

// Define the port
const PORT = process.env.PORT || 3000;

// Initialize the SQLite database
const db = new sqlite3.Database('attendance.db', (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create the 'attendance' table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employeeName TEXT NOT NULL,
  date TEXT NOT NULL,
  checkIn TEXT,
  checkOut TEXT
)`);

// Basic Authentication setup for the '/admin' route
app.use('/admin', basicAuth({
  users: { 'admin': 'yourpassword' }, // Replace 'yourpassword' with a strong password
  challenge: true,
  realm: 'Admin Area',
}));

// Get the system's temporary directory
const tmpDir = os.tmpdir();

// Route: GET '/'
app.get('/', (req, res) => {
  res.render('index');
});

// Route: POST '/attendance' - to handle form submission and save data to the database
app.post('/attendance', (req, res) => {
  const employeeName = req.body.employeeName;
  const action = req.body.action; // 'checkIn' or 'checkOut'
  const date = moment().tz('Asia/Kolkata').format('YYYY-MM-DD'); // 'YYYY-MM-DD' format
  const time = moment().tz('Asia/Kolkata').format('h:mm:ss A');  // 'h:mm:ss A' format

  // Check how many entries the employee has for today
  const sqlCount = 'SELECT * FROM attendance WHERE employeeName = ? AND date = ?';
  const paramsCount = [employeeName, date];

  db.get(sqlCount, paramsCount, (err, row) => {
    if (err) {
      console.error('Error fetching data:', err);
      res.status(500).send('An error occurred while processing your request.');
    } else {
      if (!row) {
        // No entry for today, create a new record
        const sqlInsert = 'INSERT INTO attendance (employeeName, date, ' + action + ') VALUES (?, ?, ?)';
        const paramsInsert = [employeeName, date, time];

        db.run(sqlInsert, paramsInsert, function (err) {
          if (err) {
            console.error('Error inserting data:', err);
            res.status(500).send('An error occurred while saving attendance.');
          } else {
            res.render('success'); // Render the success page
          }
        });
      } else {
        // Entry exists, update the existing record
        if (row.checkIn && row.checkOut) {
          // Both check-in and check-out are already recorded
          res.render('already', { message: 'You have already checked in and out for today.' });
        } else if (action === 'checkIn' && row.checkIn) {
          // Check-in already recorded
          res.render('already', { message: 'You have already checked in for today.' });
        } else if (action === 'checkOut' && row.checkOut) {
          // Check-out already recorded
          res.render('already', { message: 'You have already checked out for today.' });
        } else {
          // Update the record with the new action
          const sqlUpdate = 'UPDATE attendance SET ' + action + ' = ? WHERE id = ?';
          const paramsUpdate = [time, row.id];

          db.run(sqlUpdate, paramsUpdate, function (err) {
            if (err) {
              console.error('Error updating data:', err);
              res.status(500).send('An error occurred while updating attendance.');
            } else {
              res.render('success'); // Render the success page
            }
          });
        }
      }
    }
  });
});

// Route: GET '/success' - to display a success message after attendance is marked
app.get('/success', (req, res) => {
  res.render('success');
});

// Route: GET '/admin' - to display attendance records with date range filtering
app.get('/admin', (req, res) => {
  let { startDate, endDate } = req.query;

  // Default to current date if not provided
  if (!startDate || !endDate) {
    const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    startDate = startDate || today;
    endDate = endDate || today;
  }

  // Query the database for records within the date range
  const sql = `SELECT * FROM attendance WHERE date BETWEEN ? AND ? ORDER BY date DESC, employeeName`;
  const params = [startDate, endDate];

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching data:', err);
      res.status(500).send('An error occurred while fetching attendance records.');
    } else {
      res.render('admin', { records: rows, startDate, endDate });
    }
  });
});

// Route: GET '/download-report' - to generate and download the attendance report as a CSV file
app.get('/download-report', (req, res) => {
  const { startDate, endDate } = req.query;

  // Query the database for records within the date range
  const sql = `SELECT * FROM attendance WHERE date BETWEEN ? AND ? ORDER BY date DESC, employeeName`;
  const params = [startDate, endDate];

  db.all(sql, params, async (err, rows) => {
    if (err) {
      console.error('Error fetching data:', err);
      res.status(500).send('An error occurred while fetching attendance records.');
    } else if (rows.length === 0) {
      res.status(404).send('No records found for the selected date range.');
    } else {
      // Generate CSV file
      const csvWriter = createObjectCsvWriter({
        path: `${tmpDir}/attendance_report.csv`,
        header: [
          { id: 'id', title: 'ID' },
          { id: 'employeeName', title: 'Employee Name' },
          { id: 'date', title: 'Date' },
          { id: 'checkIn', title: 'Check In' },
          { id: 'checkOut', title: 'Check Out' },
        ],
      });

      try {
        await csvWriter.writeRecords(rows);

        // Send the file as a download
        res.download(`${tmpDir}/attendance_report.csv`, 'attendance_report.csv', (err) => {
          if (err) {
            console.error('Error downloading file:', err);
            res.status(500).send('An error occurred while downloading the report.');
          } else {
            // Delete the temporary file after download
            fs.unlink(`${tmpDir}/attendance_report.csv`, (err) => {
              if (err) console.error('Error deleting temp file:', err);
            });
          }
        });
      } catch (error) {
        console.error('Error generating CSV:', error);
        res.status(500).send('An error occurred while generating the report.');
      }
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
