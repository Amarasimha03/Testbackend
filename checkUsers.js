const controller = require('./controllers/assessmentController');
const Employee = require('./models/Employee');
const mongoose = require('./utils/localCache');

async function check() {
  await mongoose.connect(); // Wait for sync
  const employees = await Employee.find({});
  console.log("Employees:", employees.map(e => ({ id: e._id, role: e.role, email: e.email })));
}
check();
