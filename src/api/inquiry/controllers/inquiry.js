"use strict";
/**
 * inquiry controller
 */
Object.defineProperty(exports, "__esModule", { value: true });
const strapi_1 = require("@strapi/strapi");
const requestBuckets = new Map();
const getClientIp = (ctx) => {
    const forwardedFor = ctx.request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
        return forwardedFor.split(',')[0].trim();
    }
    return ctx.request.ip || 'unknown';
};
const normalizeBody = (ctx) => {
    var _a;
    const requestBody = (_a = ctx.request.body) !== null && _a !== void 0 ? _a : {};
    const data = requestBody.data && typeof requestBody.data === 'object' ? requestBody.data : requestBody;
    ctx.request.body = { ...requestBody, data };
    return data;
};
exports.default = strapi_1.factories.createCoreController('api::inquiry.inquiry', ({ strapi }) => ({
    async create(ctx) {
        const data = normalizeBody(ctx);
        const honeypotField = strapi.config.get('server.app.keys')
            ? strapi.config.get('custom.inquiry.honeypotField')
            : undefined;
        const configuredHoneypotField = process.env.INQUIRY_HONEYPOT_FIELD || (typeof honeypotField === 'string' ? honeypotField : 'website');
        if (configuredHoneypotField && typeof (data === null || data === void 0 ? void 0 : data[configuredHoneypotField]) === 'string' && data[configuredHoneypotField].trim() !== '') {
            return ctx.badRequest('Invalid inquiry payload.');
        }
        const name = typeof (data === null || data === void 0 ? void 0 : data.name) === 'string' ? data.name.trim() : '';
        const email = typeof (data === null || data === void 0 ? void 0 : data.email) === 'string' ? data.email.trim().toLowerCase() : '';
        const message = typeof (data === null || data === void 0 ? void 0 : data.message) === 'string' ? data.message.trim() : '';
        if (!name || !email || !message) {
            return ctx.badRequest('Name, email, and message are required.');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return ctx.badRequest('A valid email is required.');
        }
        if (name.length > 120 || email.length > 254 || message.length > 5000) {
            return ctx.badRequest('Inquiry payload is too large.');
        }
        const windowMs = Number.parseInt(process.env.INQUIRY_RATE_LIMIT_WINDOW_MS || '60000', 10);
        const maxRequests = Number.parseInt(process.env.INQUIRY_RATE_LIMIT_MAX_REQUESTS || '5', 10);
        const ip = getClientIp(ctx);
        const now = Date.now();
        const bucket = requestBuckets.get(ip);
        if (!bucket || bucket.resetAt <= now) {
            requestBuckets.set(ip, { count: 1, resetAt: now + windowMs });
        }
        else if (bucket.count >= maxRequests) {
            ctx.set('Retry-After', Math.ceil((bucket.resetAt - now) / 1000).toString());
            return ctx.tooManyRequests('Too many inquiries. Please try again later.');
        }
        else {
            bucket.count += 1;
        }
        ctx.request.body.data = {
            ...data,
            name,
            email,
            message,
        };
        return await super.create(ctx);
    },
}));
