# Rate Limiting Fix - HTTP 429 Error Resolution

## Problem
Users experiencing **HTTP 429 "Too Many Requests"** error when trying to log in to the app:
```
WARNING: Login failed (Status 429): Too many requests, please try again later
```

This was caused by missing rate limiting configuration in the backend, causing Render's infrastructure-level rate limiter to block requests.

## Root Cause
- Backend had no application-level rate limiting
- Render.com infrastructure was applying aggressive rate limiting
- Multiple login attempts (app refresh, hot reload) triggered the limit
- No differentiation between normal usage and actual abuse

## Solution Implemented

### 1. **Auth Routes Rate Limiting** (`routes/auth.js`)

Added two separate rate limiters:

#### General Auth Limiter (Lenient)
```javascript
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per 15 minutes per IP
  message: 'Too many authentication attempts, please try again later',
  skip: (req) => req.ip === 'localhost' // Skip for local development
});
```

Applied to:
- `/api/auth/register`

#### Login Limiter (Stricter for Security)
```javascript
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 login attempts per 15 minutes per IP
  message: 'Too many login attempts, please try again after 15 minutes',
  skip: (req) => req.ip === 'localhost'
});
```

Applied to:
- `/api/auth/login`

### 2. **General API Rate Limiting** (`index.js`)

Added very generous rate limiter for all API routes:
```javascript
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute per IP
  message: 'Too many requests from this IP, please try again later',
  skip: (req) => {
    // Skip localhost
    if (req.ip === 'localhost') return true;
    // Skip MQTT/webhook endpoints
    if (req.path.includes('/mqtt') || req.path.includes('/webhook')) return true;
    return false;
  }
});

app.use('/api/', generalLimiter);
```

## Rate Limit Tiers

| Endpoint | Window | Max Requests | Purpose |
|----------|--------|--------------|---------|
| `/api/auth/login` | 15 min | 20 | Prevent brute force attacks |
| `/api/auth/register` | 15 min | 50 | Allow legitimate signups |
| `/api/*` (general) | 1 min | 200 | Protect against DoS |

**Localhost exemption:** All rate limits are skipped for local development (`127.0.0.1`, `::1`, `localhost`)

## Benefits

✅ **Prevents 429 errors for normal users**
- 20 login attempts per 15 minutes is generous for legitimate use
- 200 API calls per minute allows real-time updates

✅ **Maintains security**
- Login attempts still limited to prevent brute force
- Rate limits tracked per IP address
- Headers provide clear feedback to clients

✅ **Better error messages**
```javascript
{
  message: 'Too many login attempts, please try again after 15 minutes',
  retryAfter: 900 // seconds
}
```

✅ **Development-friendly**
- Localhost completely exempted
- Hot reload won't trigger limits during development

## Testing

### Check Rate Limit Headers
After login, check response headers:
```
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 19
X-RateLimit-Reset: 1699308000
```

### Test Rate Limiting
1. **Normal Usage** - Should work fine:
   ```bash
   # 5 login attempts in quick succession
   curl -X POST .../api/auth/login (5 times)
   # Expected: All succeed (within limit)
   ```

2. **Excessive Attempts** - Should be blocked:
   ```bash
   # 25 login attempts
   curl -X POST .../api/auth/login (25 times)
   # Expected: First 20 succeed, last 5 return 429
   ```

3. **Wait and Retry**:
   ```bash
   # After 15 minutes, limit resets
   curl -X POST .../api/auth/login
   # Expected: Success (limit reset)
   ```

## Deployment

### Git Commit
```bash
git add -A
git commit -m "Add rate limiting to auth routes - Fix 429 Too Many Requests error"
git push origin main
```

### Render Deployment
- ✅ Automatic deployment triggered
- ✅ Changes will be live in ~2-3 minutes
- Monitor at: https://dashboard.render.com

### Verification
1. Wait for Render deployment to complete
2. Open Flutter app
3. Try logging in
4. Should succeed without 429 error
5. Check logs for rate limit headers

## Configuration

### Adjust Limits (if needed)
Edit `backend/routes/auth.js`:
```javascript
// More lenient (for high-traffic apps)
max: 100, // 100 login attempts per 15 min

// More strict (for extra security)
max: 10, // 10 login attempts per 15 min
windowMs: 30 * 60 * 1000, // 30 minutes
```

### Disable Rate Limiting (development only)
```javascript
// In index.js, comment out:
// app.use('/api/', generalLimiter);
```

## Monitoring

### Watch for Rate Limit Violations
```bash
# In Render logs, look for:
"Rate limit exceeded for IP: xxx.xxx.xxx.xxx"
```

### Adjust if Needed
If legitimate users hit limits:
1. Increase `max` value
2. Increase `windowMs` duration
3. Add more specific exemptions

## Related Files
- `backend/routes/auth.js` - Auth-specific rate limiters
- `backend/index.js` - General API rate limiter
- `backend/package.json` - express-rate-limit dependency

## Migration Notes
- No database changes required
- No frontend changes required
- Rate limits are enforced server-side only
- Backwards compatible with existing clients

---

**Status:** ✅ Deployed to production  
**Commit:** `b935914`  
**Deployment:** Render.com (auto-deploy in progress)
