const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_onlinetest_2024_change_me';
const token = jwt.sign({ id: '000000000000000000000000' }, JWT_SECRET, { expiresIn: '30d' });

fetch('http://localhost:5000/api/assessments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    _id: 'AA02',
    title: 'Debug Assessment',
    duration: 30,
    passingScore: 60,
    category: 'General',
    status: 'draft',
    maxViolations: 3,
    isRandomized: false
  })
})
.then(async res => {
  console.log('STATUS:', res.status);
  const text = await res.text();
  console.log('RESPONSE:', text);
})
.catch(console.error);
