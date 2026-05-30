const { querySheets } = require('./services/googleSheets');
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

async function run() {
  try {
    console.log("Fetching all results from Google Sheets...");
    const resRes = await querySheets('getResults');
    const results = resRes.data || [];
    console.log(`Total results found: ${results.length}`);
    results.forEach((r, idx) => {
      console.log(`\n--- Result ${idx + 1} ---`);
      console.log(`ID: ${r._id}`);
      console.log(`Employee ID: ${r.employeeId}`);
      console.log(`Employee Name: ${r.employeeName}`);
      console.log(`Assessment ID: ${r.assessmentId}`);
      console.log(`Assessment Title: ${r.assessmentTitle}`);
      console.log(`Status: ${r.status}`);
      console.log(`Score: ${r.totalScore}/${r.totalMarks}`);
      console.log(`Percentage: ${r.percentage}%`);
      console.log(`Passed: ${r.passed}`);
      console.log(`Answers Length: ${r.answers ? r.answers.length : 'N/A'}`);
    });
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
