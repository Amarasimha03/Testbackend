const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// A high-quality dictionary of standard tech/programming concepts for distractors and smart questions
const TECH_CONCEPTS = {
  javascript: {
    name: 'JavaScript',
    topics: [
      {
        question: 'Which of the following is used to declare a block-scoped variable in JavaScript?',
        options: ['let', 'var', 'const', 'both let and const'],
        correct: 'both let and const',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'What is the correct syntax for checking if a value is NaN in JavaScript?',
        options: ['isNaN(value)', 'value === NaN', 'value.isNaN()', 'typeof value === "nan"'],
        correct: 'isNaN(value)',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'What is the primary purpose of the "use strict" directive in JavaScript?',
        options: [
          'Enforce stricter parsing and error handling at runtime.',
          'Optimize execution speed by bypassing standard checks.',
          'Prevent the use of external APIs or imports.',
          'Automatically format the source code before execution.'
        ],
        correct: 'Enforce stricter parsing and error handling at runtime.',
        difficulty: 'medium',
        marks: 2
      },
      {
        question: 'What is the return type of the "typeof" operator for a null value in JavaScript?',
        options: ['"object"', '"null"', '"undefined"', '"string"'],
        correct: '"object"',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'Which method is used to merge two or more arrays in JavaScript without mutating the original arrays?',
        options: ['concat()', 'push()', 'join()', 'splice()'],
        correct: 'concat()',
        difficulty: 'medium',
        marks: 2
      }
    ]
  },
  react: {
    name: 'React',
    topics: [
      {
        question: 'Which hook in React is primarily used to perform side effects in a functional component?',
        options: ['useEffect', 'useState', 'useContext', 'useReducer'],
        correct: 'useEffect',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'What is the correct way to update state based on the previous state in React?',
        options: [
          'setState(prevState => prevState + 1)',
          'setState(state + 1)',
          'this.state = state + 1',
          'state.value = state.value + 1'
        ],
        correct: 'setState(prevState => prevState + 1)',
        difficulty: 'medium',
        marks: 2
      },
      {
        question: 'In React, what are "keys" used for in lists?',
        options: [
          'To help React identify which items have changed, been added, or been removed.',
          'To securely encrypt list elements inside the Virtual DOM.',
          'To apply custom CSS styling classes to individual items.',
          'To bind database unique row identifiers to the browser DOM.'
        ],
        correct: 'To help React identify which items have changed, been added, or been removed.',
        difficulty: 'medium',
        marks: 2
      },
      {
        question: 'What is the virtual DOM in React?',
        options: [
          'A lightweight, in-memory representation of the real DOM.',
          'A secure sandboxed DOM environment inside a Web Worker.',
          'A browser extension used to debug state management.',
          'A high-performance CSS rendering engine.'
        ],
        correct: 'A lightweight, in-memory representation of the real DOM.',
        difficulty: 'medium',
        marks: 2
      }
    ]
  },
  python: {
    name: 'Python',
    topics: [
      {
        question: 'Which of the following is a mutable data type in Python?',
        options: ['list', 'tuple', 'str', 'int'],
        correct: 'list',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'How is a block of code represented in Python?',
        options: ['Indentation', 'Curly braces {}', 'Parentheses ()', 'Semicolons ;'],
        correct: 'Indentation',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'What is the output of len([1, 2, 3]) in Python?',
        options: ['3', '4', '2', 'Error'],
        correct: '3',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'Which keyword is used to define a function in Python?',
        options: ['def', 'function', 'func', 'define'],
        correct: 'def',
        difficulty: 'easy',
        marks: 1
      }
    ]
  },
  java: {
    name: 'Java',
    topics: [
      {
        question: 'Which keyword is used to inherit a class in Java?',
        options: ['extends', 'implements', 'inherits', 'import'],
        correct: 'extends',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'What is the size of a "double" data type in Java?',
        options: ['8 bytes', '4 bytes', '2 bytes', '16 bytes'],
        correct: '8 bytes',
        difficulty: 'medium',
        marks: 2
      },
      {
        question: 'Which class is the superclass of all classes in Java?',
        options: ['Object', 'Class', 'String', 'System'],
        correct: 'Object',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'Which of the following is NOT a primitive data type in Java?',
        options: ['String', 'int', 'char', 'boolean'],
        correct: 'String',
        difficulty: 'easy',
        marks: 1
      }
    ]
  },
  sql: {
    name: 'SQL',
    topics: [
      {
        question: 'Which SQL clause is used to filter group results after grouping?',
        options: ['HAVING', 'WHERE', 'GROUP BY', 'ORDER BY'],
        correct: 'HAVING',
        difficulty: 'medium',
        marks: 2
      },
      {
        question: 'Which constraint uniquely identifies each record in a database table?',
        options: ['PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'NOT NULL'],
        correct: 'PRIMARY KEY',
        difficulty: 'easy',
        marks: 1
      },
      {
        question: 'Which SQL join returns all rows from the left table, and matching rows from the right table?',
        options: ['LEFT JOIN', 'INNER JOIN', 'RIGHT JOIN', 'FULL JOIN'],
        correct: 'LEFT JOIN',
        difficulty: 'easy',
        marks: 1
      }
    ]
  }
};

// Generic/Theory distractors and concepts
const THEORY_TOPICS = [
  {
    keywords: ['cloud', 'aws', 'azure', 'serverless'],
    question: 'Which of the following describes the key benefit of Cloud Computing?',
    options: ['On-demand self-service and scalability', 'Fixed operational costs', 'Zero latency', 'Guaranteed local physical security'],
    correct: 'On-demand self-service and scalability',
    difficulty: 'easy',
    marks: 1
  },
  {
    keywords: ['database', 'data', 'storage', 'nosql', 'mongodb'],
    question: 'What is the primary difference between SQL and NoSQL databases?',
    options: [
      'SQL databases are relational and table-based; NoSQL are non-relational and document/key-value based.',
      'SQL databases are open-source; NoSQL are strictly commercial.',
      'SQL databases do not support transactions; NoSQL support only synchronous ACID transactions.',
      'SQL databases operate only in memory; NoSQL are strictly disk-based.'
    ],
    correct: 'SQL databases are relational and table-based; NoSQL are non-relational and document/key-value based.',
    difficulty: 'medium',
    marks: 2
  },
  {
    keywords: ['agile', 'scrum', 'project', 'development', 'sprint'],
    question: 'In Scrum framework, what is the primary role of the Scrum Master?',
    options: [
      'To facilitate the team, remove blockers, and ensure Scrum guidelines are followed.',
      'To write technical specifications and assign tasks to developers.',
      'To manage project budget, vendor contracts, and client billings.',
      'To make final decisions on product design and deployment architectures.'
    ],
    correct: 'To facilitate the team, remove blockers, and ensure Scrum guidelines are followed.',
    difficulty: 'medium',
    marks: 2
  },
  {
    keywords: ['api', 'rest', 'http', 'json', 'postman'],
    question: 'Which HTTP method is typically used to update an existing resource or create it if it does not exist?',
    options: ['PUT', 'POST', 'GET', 'DELETE'],
    correct: 'PUT',
    difficulty: 'easy',
    marks: 1
  },
  {
    keywords: ['git', 'version', 'branch', 'merge', 'commit'],
    question: 'Which Git command is used to record project changes in the local repository history?',
    options: ['git commit', 'git push', 'git add', 'git save'],
    correct: 'git commit',
    difficulty: 'easy',
    marks: 1
  },
  {
    keywords: ['security', 'encryption', 'ssl', 'tls', 'cyber'],
    question: 'What is the primary purpose of SSL/TLS encryption in web communication?',
    options: [
      'To secure data in transit between the client browser and the server.',
      'To compress images and assets to speed up website load times.',
      'To prevent cross-site scripting vulnerabilities on the server database.',
      'To verify the source code license of the web application.'
    ],
    correct: 'To secure data in transit between the client browser and the server.',
    difficulty: 'medium',
    marks: 2
  }
];

/**
 * Extracts printable ASCII/UTF8 strings from a raw binary buffer
 */
function extractPrintableStrings(buffer) {
  let text = '';
  // Convert buffer to string with ascii/utf8 translation
  const rawString = buffer.toString('utf-8');
  // Split by lines first to preserve layout structure
  const lines = rawString.split(/[\r\n]+/);
  // Match printable word sequences (at least 6 characters, allowing spaces, common punctuation)
  const regex = /[a-zA-Z0-9\s,.\-':()]{6,150}/g;
  
  const cleanLines = lines.map(line => {
    const matches = line.match(regex);
    if (!matches) return '';
    return matches
      .map(m => m.trim())
      .filter(m => m.length > 3 && !/^[0-9\s.,:\-]+$/.test(m))
      .join(' ');
  }).filter(line => line.length > 0);

  return cleanLines.join('\n');
}

/**
 * Generates MCQs based on analyzed content
 */
function isLineQuestionStart(line) {
  // 1. Matches "1. What is...", "Q1. What...", "Q1: What...", "Question 1: What...", "Q-1) What...", "100. Which..."
  const questionStartRegex = /^(?:q(?:uestion)?(?:[-_]?\d+)?[\s.:-]*|\d+[\s.:-]+)\s*(.+)$/i;
  if (line.match(questionStartRegex)) {
    return true;
  }
  
  // 2. Ends with a question mark "?"
  if (line.endsWith('?')) {
    return true;
  }

  // 3. Starts with common question words and contains "?" or is long enough
  const questionWords = /^(?:what|which|how|why|who|when|where|define|explain|is|does|can|should|are|whose|whom)\b/i;
  if (questionWords.test(line) && (line.includes('?') || line.length > 25)) {
    return true;
  }

  return false;
}

function parseQuestionsFromText(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  const questions = [];
  let currentQuestion = null;

  // Regular expression to check if a line is a question start:
  const questionStartRegex = /^(?:q(?:uestion)?(?:[-_]?\d+)?[\s.:-]*|\d+[\s.:-]+)\s*(.+)$/i;

  // Option regex:
  // e.g. "A) text", "a. text", "1) text", "[A] text" (allows optional spacing before punctuations)
  const optionRegex = /^(?:[A-D1-4a-d]\s*[-.)\]]|\[[A-D1-4a-d]\])\s*(.+)$/i;

  // Answer regex:
  // e.g. "Answer: A", "Correct: A", "Correct Answer: B", "Ans: A"
  const answerRegex = /^(?:answer|correct\s*answer|correct|ans)[\s.:-]*\s*(.+)$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Check if it's a correct answer line
    const ansMatch = line.match(answerRegex);
    if (ansMatch && currentQuestion) {
      currentQuestion.correct = ansMatch[1].trim();
      continue;
    }

    // 2. Check if it's an option line (takes precedence over question start to avoid false positives)
    const optMatch = line.match(optionRegex);
    if (optMatch && currentQuestion) {
      let optText = optMatch[1].trim();
      let isCorrect = false;
      if (optText.startsWith('*')) {
        optText = optText.substring(1).trim();
        isCorrect = true;
      } else if (optText.endsWith('*')) {
        optText = optText.slice(0, -1).trim();
        isCorrect = true;
      }
      currentQuestion.options.push({ text: optText, isCorrect });
      continue;
    }

    // 3. Check if it's a question start
    if (isLineQuestionStart(line)) {
      if (currentQuestion && currentQuestion.options.length >= 2) {
        questions.push(currentQuestion);
      }
      
      const qMatch = line.match(questionStartRegex);
      const qText = qMatch ? qMatch[1].trim() : line;
      
      currentQuestion = {
        question: qText,
        options: [],
        correct: null,
        difficulty: 'medium',
        marks: 2
      };
      continue;
    }

    // 4. Fallback: Add as raw option line if we have a current question and < 4 options
    if (currentQuestion && currentQuestion.options.length < 4) {
      let optText = line;
      let isCorrect = false;
      if (optText.startsWith('*')) {
        optText = optText.substring(1).trim();
        isCorrect = true;
      } else if (optText.endsWith('*')) {
        optText = optText.slice(0, -1).trim();
        isCorrect = true;
      }
      currentQuestion.options.push({ text: optText, isCorrect });
    }
  }

  // Push the last question
  if (currentQuestion && currentQuestion.options.length >= 2) {
    questions.push(currentQuestion);
  }

  // Post-process
  const parsedList = [];
  questions.forEach(q => {
    if (q.options.length > 0) {
      // Find which option is correct
      let correctIndex = q.options.findIndex(opt => opt.isCorrect === true);
      
      if (correctIndex === -1 && q.correct) {
        const correctStr = q.correct.toLowerCase().trim();
        // Check if correct is a letter index (a, b, c, d)
        if (correctStr.length === 1 && ['a', 'b', 'c', 'd'].includes(correctStr)) {
          correctIndex = ['a', 'b', 'c', 'd'].indexOf(correctStr);
        } else if (correctStr.length === 1 && ['1', '2', '3', '4'].includes(correctStr)) {
          correctIndex = ['1', '2', '3', '4'].indexOf(correctStr);
        } else {
          // Try to match option text
          correctIndex = q.options.findIndex(opt => opt.text.toLowerCase().trim() === correctStr || opt.text.toLowerCase().trim().endsWith(correctStr));
        }
      }

      if (correctIndex === -1 && q.correct) {
        correctIndex = q.options.findIndex(opt => opt.text.toLowerCase().includes(q.correct.toLowerCase()) || q.correct.toLowerCase().includes(opt.text.toLowerCase()));
      }

      if (correctIndex === -1) {
        correctIndex = 0; // fallback to first option
      }

      // Ensure we have exactly 4 options by filling with default distractors if we have fewer
      const finalOptions = q.options.map((opt, idx) => ({
        text: typeof opt === 'string' ? opt : opt.text,
        isCorrect: idx === correctIndex
      }));

      while (finalOptions.length < 4) {
        finalOptions.push({
          text: `Option ${finalOptions.length + 1}`,
          isCorrect: finalOptions.length === correctIndex
        });
      }

      const finalOptionsSliced = finalOptions.slice(0, 4);
      // Ensure at least one correct option
      if (!finalOptionsSliced.some(o => o.isCorrect)) {
        finalOptionsSliced[0].isCorrect = true;
      }

      const correctText = finalOptionsSliced.find(o => o.isCorrect).text;

      parsedList.push({
        question: q.question,
        options: finalOptionsSliced.map(o => o.text),
        correct: correctText,
        difficulty: q.difficulty || 'medium',
        marks: q.marks || 2
      });
    }
  });

  return parsedList;
}

exports.generateQuestionsFromText = async (fileName, fileContentBase64OrText) => {
  const isTxt = fileName.toLowerCase().endsWith('.txt');
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const isDocx = fileName.toLowerCase().endsWith('.docx');
  let extractedText = '';

  if (isTxt) {
    extractedText = fileContentBase64OrText;
  } else if (isPdf) {
    try {
      const buffer = Buffer.from(fileContentBase64OrText, 'base64');
      const pdfData = await pdfParse(buffer);
      extractedText = pdfData.text || '';
    } catch (e) {
      console.error('Error parsing PDF document:', e);
      try {
        const buffer = Buffer.from(fileContentBase64OrText, 'base64');
        extractedText = extractPrintableStrings(buffer);
      } catch (inner) {
        extractedText = fileContentBase64OrText || '';
      }
    }
  } else if (isDocx) {
    try {
      const buffer = Buffer.from(fileContentBase64OrText, 'base64');
      const docxData = await mammoth.extractRawText({ buffer });
      extractedText = docxData.value || '';
    } catch (e) {
      console.error('Error parsing DOCX document:', e);
      try {
        const buffer = Buffer.from(fileContentBase64OrText, 'base64');
        extractedText = extractPrintableStrings(buffer);
      } catch (inner) {
        extractedText = fileContentBase64OrText || '';
      }
    }
  } else {
    try {
      const buffer = Buffer.from(fileContentBase64OrText, 'base64');
      extractedText = extractPrintableStrings(buffer);
    } catch (e) {
      extractedText = fileContentBase64OrText || '';
    }
  }

  if (!extractedText || extractedText.trim().length === 0) {
    try {
      const buffer = Buffer.from(fileContentBase64OrText, 'base64');
      extractedText = extractPrintableStrings(buffer);
    } catch (e) {
      extractedText = fileContentBase64OrText || '';
    }
  }

  const textLower = extractedText.toLowerCase();
  const generatedList = [];
  const addedQuestions = new Set();

  // Helper to add question to output avoiding duplicates
  const addQuestion = (qObj) => {
    const key = qObj.question.toLowerCase().trim();
    if (!addedQuestions.has(key)) {
      addedQuestions.add(key);
      generatedList.push({
        title: qObj.question,
        type: 'mcq',
        difficulty: qObj.difficulty || 'medium',
        marks: qObj.marks || 2,
        options: qObj.options.map(text => ({
          text,
          isCorrect: text === qObj.correct
        })),
        correctAnswer: qObj.correct
      });
    }
  };

  // 1. Try to parse structured MCQs directly from the text if they are pre-formatted
  const parsedQuestions = parseQuestionsFromText(extractedText);
  if (parsedQuestions.length > 0) {
    parsedQuestions.forEach(q => {
      addQuestion({
        question: q.question,
        options: q.options,
        correct: q.correct,
        difficulty: q.difficulty,
        marks: q.marks
      });
    });
  }

  // 2. Scan the entire document text comprehensive to extract all key definitions, features, and concepts
  const sentences = extractedText.split(/[.!?\n]+\s*/).map(s => s.trim()).filter(s => s.length > 20);
  
  const patterns = [
    {
      regex: /([A-Z][a-zA-Z0-9\s]{1,30})\s+(?:is|are)\s+(?:defined\s+as|referred\s+to\s+as)?\s*(?:a|an)?\s+([a-zA-Z0-9\s,.-]{10,120})/i,
      formatter: (term, desc) => ({
        question: `What is the definition or primary characteristic of ${term.trim()}?`,
        correct: desc.trim(),
        distractors: [
          `A legacy database protocol deprecated in modern development`,
          `An optimization technique used strictly for micro-frontend services`,
          `A hardware-level instruction caching mechanism`,
          `A secondary background process for scheduling routine updates`
        ]
      })
    },
    {
      regex: /([A-Z][a-zA-Z0-9\s]{1,30})\s+(?:refers\s+to|means)\s+([a-zA-Z0-9\s,.-]{10,120})/i,
      formatter: (term, desc) => ({
        question: `What does the term "${term.trim()}" refer to?`,
        correct: desc.trim(),
        distractors: [
          `A synchronous data mutation methodology`,
          `A low-level memory allocation standard`,
          `A network routing policy for edge computing`,
          `An encryption standard used for local session caching`
        ]
      })
    },
    {
      regex: /([A-Z][a-zA-Z0-9\s]{1,30})\s+(?:was\s+created|was\s+developed|was\s+founded|was\s+released)\s+by\s+([a-zA-Z0-9\s,.-]{2,50})\s+in\s+(\d{4})/i,
      formatter: (term, creator, year) => ({
        question: `Who created ${term.trim()} and in what year was it released?`,
        correct: `${creator.trim()} in ${year.trim()}`,
        distractors: [
          `Brendan Eich in 1995`,
          `The World Wide Web Consortium in 2004`,
          `Microsoft Open Source Group in 2012`,
          `The Apache Software Foundation in 1999`
        ]
      })
    },
    {
      regex: /(?:the\s+)?(?:primary|key|main)\s+(?:purpose|objective|benefit|advantage|goal)\s+of\s+([a-zA-Z0-9\s]{2,40})\s+(?:is|refers\s+to)\s+([a-zA-Z0-9\s,.-]{10,120})/i,
      formatter: (subject, benefit) => ({
        question: `What is the primary purpose or key advantage of ${subject.trim()}?`,
        correct: benefit.trim(),
        distractors: [
          `To minimize bandwidth consumption by disabling network requests`,
          `To secure third-party dependencies against runtime script injections`,
          `To automate localized unit testing for web server frameworks`,
          `To synchronize redundant database clusters across regions`
        ]
      })
    }
  ];

  sentences.forEach(sentence => {
    patterns.forEach(p => {
      const match = sentence.match(p.regex);
      if (match) {
        const term = match[1];
        if (term && term.split(' ').length <= 4) { // exclude overly broad matched segments
          const formatted = p.formatter(...match.slice(1));
          
          // Generate 3 unique distractors that don't match the correct answer
          const distractorsFiltered = formatted.distractors
            .filter(d => d.toLowerCase() !== formatted.correct.toLowerCase())
            .slice(0, 3);
            
          const options = [formatted.correct, ...distractorsFiltered].sort(() => Math.random() - 0.5);
          
          addQuestion({
            question: formatted.question,
            options,
            correct: formatted.correct,
            difficulty: 'medium',
            marks: 2
          });
        }
      }
    });
  });

  // 3. Fallback only if needed: Scan text for programming keywords and pull relevant questions
  if (generatedList.length < 5) {
    Object.keys(TECH_CONCEPTS).forEach(lang => {
      if (textLower.includes(lang)) {
        const concept = TECH_CONCEPTS[lang];
        concept.topics.forEach(topic => {
          addQuestion(topic);
        });
      }
    });
  }

  // 4. Fallback only if needed: Scan for theory topics
  if (generatedList.length < 5) {
    THEORY_TOPICS.forEach(topic => {
      const matchesKeyword = topic.keywords.some(kw => textLower.includes(kw));
      if (matchesKeyword) {
        addQuestion(topic);
      }
    });
  }

  // 5. Default Fallbacks: If no matches are found, or we want at least 5 questions
  if (generatedList.length < 5) {
    const fileWord = fileName.split('.')[0].replace(/[-_]/g, ' ');
    const fallbackQuestions = [
      {
        question: `What is the main topic covered in the "${fileWord}" document?`,
        options: ['Core conceptual architecture and fundamentals', 'Market competition analysis', 'Historical database performance', 'Hardware supply chain management'],
        correct: 'Core conceptual architecture and fundamentals',
        difficulty: 'medium',
        marks: 2
      },
      {
        question: `Which of the following represents the primary objective discussed in the "${fileWord}" document?`,
        options: ['Standardizing system architecture and best practices', 'Deprecating legacy cloud APIs', 'Automating email notifications', 'Conducting physical database audits'],
        correct: 'Standardizing system architecture and best practices',
        difficulty: 'medium',
        marks: 2
      },
      {
        question: `True or False: The concepts presented in the "${fileWord}" document are applicable to modern software industry standards.`,
        options: ['True', 'False', 'Not Applicable', 'None of the above'],
        correct: 'True',
        difficulty: 'easy',
        marks: 1
      }
    ];

    fallbackQuestions.forEach(topic => {
      addQuestion(topic);
    });
  }

  // Double check question difficulty default marks match:
  // Easy = 1, Medium = 2, Hard = 3
  generatedList.forEach(q => {
    if (q.difficulty === 'easy') q.marks = 1;
    else if (q.difficulty === 'medium') q.marks = 2;
    else if (q.difficulty === 'hard') q.marks = 3;
  });

  return generatedList.slice(0, 350); // Return top generated questions (supports up to 350+ MCQs)
};
