const fs = require('fs');
const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));

// Fix each assessment: link questions whose .assessment field matches
db.assessments.forEach(asmt => {
  // Remove corrupt Mongoose operator keys stored as literal properties
  Object.keys(asmt).forEach(k => {
    if (k.startsWith('$')) delete asmt[k];
  });

  // Collect question IDs that belong to this assessment
  const qIds = db.questions
    .filter(q => q.assessment === asmt._id || !q.assessment)
    .map(q => q._id);

  // Assign any unlinked questions to this assessment
  db.questions.forEach(q => {
    if (!q.assessment) q.assessment = asmt._id;
  });

  asmt.questions = qIds;
  console.log(`Assessment "${asmt.title}" now has ${qIds.length} questions.`);
});

fs.writeFileSync('db.json', JSON.stringify(db, null, 2));
console.log('db.json fixed successfully!');
