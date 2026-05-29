require('dotenv').config();
const { querySheets } = require('./services/googleSheets');

(async () => {
  try {
    const assRes = await querySheets('getAssessments');
    console.log("ASSESSMENTS:", assRes?.data?.length);
    
    const empRes = await querySheets('getEmployees');
    console.log("EMPLOYEES:", empRes?.data?.length);
    
    const resRes = await querySheets('getResults');
    console.log("RESULTS:", resRes?.data?.length);
    
    const vRes = await querySheets('getViolations');
    console.log("VIOLATIONS:", vRes?.data?.length);
  } catch(e) {
    console.error("ERROR:", e);
  }
})();
