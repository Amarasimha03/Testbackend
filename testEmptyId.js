// native fetch

async function test() {
  try {
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@gmail.com', password: 'Admin123' })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;

    console.log('Creating assessment with empty _id...');
    const postRes = await fetch('http://localhost:5000/api/assessments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        _id: '',
        title: 'Empty ID Assessment',
        duration: 30,
        passingScore: 60,
        category: 'General',
        status: 'draft',
        maxViolations: 3,
        isRandomized: false
      })
    });
    console.log('POST Status:', postRes.status);
    console.log('POST Body:', await postRes.text());
  } catch (err) {
    console.error(err);
  }
}
test();
