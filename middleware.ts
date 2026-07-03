import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'pp_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

// Only protect the main app — leave API routes open for server-side calls
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;

  // If no password is configured, allow through (dev mode / not set up yet)
  if (!password) return NextResponse.next();

  // Already authenticated via cookie
  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (cookie === password) return NextResponse.next();

  // Handle login form submission
  if (request.method === 'POST') {
    const url = new URL(request.url);
    if (url.pathname === '/__login') {
      // We can't read the body in middleware easily, so we use a query param
      const submitted = url.searchParams.get('p');
      if (submitted === password) {
        const res = NextResponse.redirect(new URL('/', request.url));
        res.cookies.set(COOKIE_NAME, password, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: COOKIE_MAX_AGE,
          path: '/',
        });
        return res;
      }
      // Wrong password — show login page with error
      return new NextResponse(loginPage(true), {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      });
    }
  }

  // Show login page
  return new NextResponse(loginPage(false), {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

function loginPage(wrongPassword: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pascal Press — Marketing Planner</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.10);
      padding: 40px 36px;
      width: 100%;
      max-width: 380px;
    }
    .logo {
      width: 40px; height: 40px;
      background: #1d4ed8;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px;
    }
    .logo span { color: white; font-size: 13px; font-weight: 700; }
    h1 { text-align: center; font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 4px; }
    p  { text-align: center; font-size: 13px; color: #64748b; margin-bottom: 28px; }
    label { display: block; font-size: 13px; font-weight: 500; color: #374151; margin-bottom: 6px; }
    input[type="password"] {
      width: 100%; padding: 10px 14px;
      border: 1.5px solid #d1d5db; border-radius: 8px;
      font-size: 15px; outline: none;
      transition: border-color .15s;
    }
    input[type="password"]:focus { border-color: #1d4ed8; }
    .error {
      margin-top: 8px; padding: 8px 12px;
      background: #fef2f2; border: 1px solid #fecaca;
      border-radius: 6px; color: #dc2626;
      font-size: 13px; text-align: center;
    }
    button {
      margin-top: 16px; width: 100%;
      padding: 11px; background: #1d4ed8;
      color: white; border: none; border-radius: 8px;
      font-size: 15px; font-weight: 500; cursor: pointer;
      transition: background .15s;
    }
    button:hover { background: #1e40af; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><span>PP</span></div>
    <h1>Marketing Planner</h1>
    <p>Pascal Press internal tool</p>
    <form method="GET" action="/__login" onsubmit="handleSubmit(event)">
      <label for="pw">Password</label>
      <input type="password" id="pw" name="p" placeholder="Enter password" autofocus autocomplete="current-password" />
      ${wrongPassword ? '<div class="error">Incorrect password — please try again.</div>' : ''}
      <button type="submit">Continue</button>
    </form>
  </div>
  <script>
    function handleSubmit(e) {
      e.preventDefault();
      const pw = document.getElementById('pw').value;
      window.location.href = '/__login?p=' + encodeURIComponent(pw);
    }
  </script>
</body>
</html>`;
}
