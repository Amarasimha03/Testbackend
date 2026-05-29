require('dotenv').config();
const { getDashboardStats } = require('./controllers/assessmentController');
const { getAnalytics } = require('./controllers/resultController');
const { getViolationStats } = require('./controllers/violationController');

const mockRes = {
  json: (data) => console.log('JSON SUCCESS:', Object.keys(data)),
  status: (code) => {
    console.log('STATUS:', code);
    return {
      json: (data) => console.log('JSON ERROR:', data)
    };
  }
};

(async () => {
  console.log("Testing getDashboardStats...");
  await getDashboardStats({}, mockRes);
  
  console.log("Testing getAnalytics...");
  await getAnalytics({}, mockRes);
  
  console.log("Testing getViolationStats...");
  await getViolationStats({}, mockRes);
})();
