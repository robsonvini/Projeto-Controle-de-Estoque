const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function getJwtSecret() {
    return process.env.JWT_SECRET || 'dev-secret-change-me';
}

async function hashPassword(password) {
    return bcrypt.hash(String(password), 12);
}

async function comparePassword(password, passwordHash) {
    return bcrypt.compare(String(password), String(passwordHash || ''));
}

function signToken(user) {
    return jwt.sign(
        {
            sub: String(user.id),
            email: user.email,
            name: user.name
        },
        getJwtSecret(),
        {
            expiresIn: process.env.JWT_EXPIRES_IN || '8h'
        }
    );
}

function authenticateToken(req, res, next) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Token de autenticação ausente.' });
    }

    try {
        const payload = jwt.verify(token, getJwtSecret());
        req.auth = {
            id: Number(payload.sub),
            email: payload.email,
            name: payload.name
        };
        return next();
    } catch {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
}

module.exports = {
    authenticateToken,
    comparePassword,
    hashPassword,
    signToken
};