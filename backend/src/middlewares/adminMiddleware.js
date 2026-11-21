const userMiddleware = require('./userMiddleware');

const adminMiddleware = (req, res, next) => userMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Administrator access is required' });
    }
    next();
});

module.exports = adminMiddleware;
