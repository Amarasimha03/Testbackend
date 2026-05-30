const { querySheets } = require('./services/googleSheets');
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

async function run() {
  try {
    console.log("Fetching results from Google Sheets...");
    const resRes = await querySheets('getResults');
    const results = resRes.data || [];
    console.log(`Total results found: ${results.length}`);
    if (results.length > 0) {
      console.log("First result keys and values:");
      console.log(JSON.stringify(results[0], null, 2));
    } else {
      console.log("No results found in Google Sheets.");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
