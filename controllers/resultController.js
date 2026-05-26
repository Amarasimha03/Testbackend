const Result = require('../models/Result');
const Assessment = require('../models/Assessment');
const Violation = require('../models/Violation');

exports.getResults = async (req, res) => {
  try {
    const { assessmentId, employeeId } = req.query;
    const filter = {};
    if (assessmentId) filter.assessment = assessmentId;
    if (employeeId) filter.employee = employeeId;
    if (req.user.role === 'employee') filter.employee = req.user._id;
    const results = await Result.find(filter)
      .populate('employee', 'fullName email department')
      .populate('assessment', 'title passingScore')
      .sort({ submittedAt: -1 });

    const mapped = results.map(r => {
      const item = typeof r.toObject === 'function' ? r.toObject() : { ...r };
      // If populate returned a plain ID or empty employee, rebuild the avatar info using hydrations
      if (!item.employee || typeof item.employee === 'string') {
        item.employee = {
          _id: item.employee,
          fullName: item.employeeName || 'Unknown Candidate',
          email: item.employeeEmail || 'No Email',
          department: 'General'
        };
      }
      return item;
    });

    res.json({ success: true, results: mapped });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getResult = async (req, res) => {
  try {
    const result = await Result.findById(req.params.id)
      .populate('employee', 'fullName email department')
      .populate({ path: 'assessment', populate: { path: 'questions' } })
      .populate('answers.question');
    if (!result) return res.status(404).json({ success: false, message: 'Result not found' });
    
    // Security Rules validation
    if (req.user.role === 'employee') {
      // Prevent access to another employee's result
      if (result.employee._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied to this result' });
      }
      // Prevent viewing answers or result page before submission
      if (result.status === 'in-progress') {
        return res.status(403).json({ success: false, message: 'Answers and results are hidden during an active exam.' });
      }
    }
    
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getRankList = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const results = await Result.find({
      assessment: assessmentId,
      status: { $in: ['submitted', 'auto-submitted'] }
    }).populate('employee', 'fullName email department').sort({ totalScore: -1, completionTime: 1 });
    const ranked = results.map((r, i) => ({ ...r.toObject(), rank: i + 1 }));
    res.json({ success: true, rankList: ranked });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getAnalytics = async (req, res) => {
  try {
    const [
      totalResults, passedResults, avgScoreAgg, departmentPerf, timeAnalysis
    ] = await Promise.all([
      Result.countDocuments({ status: { $in: ['submitted', 'auto-submitted'] } }),
      Result.countDocuments({ status: { $in: ['submitted', 'auto-submitted'] }, passed: true }),
      Result.aggregate([{ $group: { _id: null, avg: { $avg: '$percentage' } } }]),
      Result.aggregate([
        { $lookup: { from: 'employees', localField: 'employee', foreignField: '_id', as: 'emp' } },
        { $unwind: '$emp' },
        { $group: { _id: '$emp.department', avgScore: { $avg: '$percentage' }, count: { $sum: 1 } } },
        { $sort: { avgScore: -1 } }
      ]),
      Result.aggregate([
        { $group: { _id: null, avgTime: { $avg: '$completionTime' } } }
      ])
    ]);
    const totalViolations = await Violation.countDocuments();
    res.json({
      success: true, analytics: {
        totalResults, passedResults, failedResults: totalResults - passedResults,
        passRate: totalResults ? Math.round((passedResults / totalResults) * 100) : 0,
        avgScore: avgScoreAgg[0]?.avg ? Math.round(avgScoreAgg[0].avg) : 0,
        avgCompletionTime: timeAnalysis[0]?.avgTime ? Math.round(timeAnalysis[0].avgTime) : 0,
        departmentPerformance: departmentPerf,
        totalViolations,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
