const mockReq = {
  body: { title: 'Test Assessment', duration: 30, category: 'General' },
  user: { _id: 'admin_id_123', fullName: 'Test Admin' }
};
const mockRes = {
  status: function(s) { console.log('STATUS:', s); return this; },
  json: function(j) { console.log('JSON:', j); return this; }
};

const controller = require('./controllers/assessmentController');
const Employee = require('./models/Employee');

async function run() {
  await Employee.create({ _id: 'emp_123', fullName: 'Employee', role: 'employee', isActive: true });
  await controller.createAssessment(mockReq, mockRes);
  console.log('Done');
}

run().catch(console.error);
