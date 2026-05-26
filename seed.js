require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('./utils/localCache');
const Employee = require('./models/Employee');
const Assessment = require('./models/Assessment');
const Question = require('./models/Question');
const Result = require('./models/Result');
const Violation = require('./models/Violation');
const AuditLog = require('./models/AuditLog');

const seed = async () => {
  try {
    await mongoose.connect();
    console.log('Google Sheets database connected for seeding...');

    // Clear existing data
    await Employee.deleteMany({});
    await Assessment.deleteMany({});
    await Question.deleteMany({});
    await Result.deleteMany({});
    await Violation.deleteMany({});
    await AuditLog.deleteMany({});
    console.log('Cleared database collections.');

    // Create Admin
    const admin = new Employee({
      fullName: 'System Admin',
      email: 'admin@test.com',
      phone: '1234567890',
      password: 'adminpassword',
      department: 'IT Support',
      designation: 'Platform Administrator',
      company: 'AssessHub Inc.',
      companyWebsite: 'https://assesshub.com',
      role: 'admin',
      isVerified: true,
      isActive: true,
      loginHistory: [{
        ip: '127.0.0.1',
        userAgent: 'Seed Script',
        device: 'Server',
        loginAt: new Date(),
        status: 'success',
      }],
    });
    await admin.save();
    console.log('Admin user created: admin@test.com / adminpassword');

    // Create Demo Employee
    const employee = new Employee({
      fullName: 'John Doe',
      email: 'employee@test.com',
      phone: '0987654321',
      password: 'employeepassword',
      department: 'Engineering',
      designation: 'Software Developer',
      company: 'AssessHub Inc.',
      role: 'employee',
      isVerified: true,
      isActive: true,
      resume: {
        fileName: 'john_doe_resume.pdf',
        fileUrl: '/uploads/resumes/john_doe_resume.pdf',
        uploadedAt: new Date(),
        fileSize: 245760,
      },
    });
    await employee.save();
    console.log('Employee user created: employee@test.com / employeepassword');

    // Create an assessment
    const assessment = new Assessment({
      title: 'JavaScript & React Technical Assessment',
      description: 'Test your understanding of React state management, hooks, async operations, and JavaScript ES6+ specifications.',
      duration: 15,
      timePerQuestion: 30,
      passingScore: 60,
      isRandomized: false,
      maxViolations: 3,
      status: 'active',
      category: 'Technical',
      createdBy: admin._id,
      assignedTo: [employee._id]
    });
    await assessment.save();

    // Assign to employee
    employee.assignedAssessments.push(assessment._id);
    await employee.save();
    console.log('Assessment created and assigned to John Doe');

    // Create questions for assessment
    const questions = [
      {
        title: 'Which React Hook is used to perform side effects in a functional component?',
        type: 'mcq',
        options: [
          { text: 'useState', isCorrect: false },
          { text: 'useEffect', isCorrect: true },
          { text: 'useContext', isCorrect: false },
          { text: 'useReducer', isCorrect: false }
        ],
        marks: 2,
        difficulty: 'easy',
        assessment: assessment._id,
        createdBy: admin._id
      },
      {
        title: 'Choose the correct statement(s) regarding React state updates:',
        type: 'multiple-select',
        options: [
          { text: 'State updates may be asynchronous.', isCorrect: true },
          { text: 'State updates are always synchronous.', isCorrect: false },
          { text: 'State updates are batched for performance optimization.', isCorrect: true },
          { text: 'You should directly mutate the state object.', isCorrect: false }
        ],
        marks: 3,
        difficulty: 'medium',
        assessment: assessment._id,
        createdBy: admin._id
      },
      {
        title: 'True or False: React components must start with a capital letter.',
        type: 'true-false',
        options: [
          { text: 'True', isCorrect: true },
          { text: 'False', isCorrect: false }
        ],
        marks: 1,
        difficulty: 'easy',
        assessment: assessment._id,
        createdBy: admin._id
      },
      {
        title: 'What is the purpose of "key" prop in React lists?',
        type: 'mcq',
        options: [
          { text: 'To uniquely identify list items among siblings and help React identify changes.', isCorrect: true },
          { text: 'To bind database row IDs to the DOM elements directly.', isCorrect: false },
          { text: 'To apply custom CSS styling classes to individual items.', isCorrect: false },
          { text: 'To make list items focusable via Keyboard Tab key.', isCorrect: false }
        ],
        marks: 2,
        difficulty: 'medium',
        assessment: assessment._id,
        createdBy: admin._id
      }
    ];

    const savedQuestions = await Question.insertMany(questions);
    
    // Add question references to assessment
    assessment.questions = savedQuestions.map(q => q._id);
    await assessment.save();
    console.log('Seeded 4 questions for the assessment successfully.');

    // Seed initial audit logs
    await AuditLog.create([
      {
        user: admin._id, action: 'login',
        description: 'System Admin initial seed login',
        ip: '127.0.0.1', userAgent: 'Seed Script',
      },
      {
        user: admin._id, action: 'assessment-created',
        description: 'Assessment created: "JavaScript & React Technical Assessment"',
        targetModel: 'Assessment', targetId: assessment._id,
      },
      {
        user: admin._id, action: 'employee-created',
        description: 'Admin created employee: John Doe (employee@test.com)',
        targetModel: 'Employee', targetId: employee._id,
      },
    ]);
    console.log('Seeded audit logs.');

    mongoose.disconnect();
    console.log('Database seeding finished successfully!');
  } catch (err) {
    console.error('Error during database seeding:', err);
    process.exit(1);
  }
};

seed();
