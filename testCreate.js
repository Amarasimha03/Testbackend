const mockReq = {
  body: { title: 'Test Assessment', duration: 30, category: 'General' },
  user: { _id: 'admin_id_123', fullName: 'Test Admin' }
};
const mockRes = {
  status: function(s) { console.log('STATUS:', s); return this; },
  json: function(j) { console.log('JSON:', j); return this; }
};

const controller = require('./controllers/assessmentController');
controller.createAssessment(mockReq, mockRes).then(() => console.log('Done')).catch(console.error);
