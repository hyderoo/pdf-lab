import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isLoginPage = pathname === "/masuk";

  if (isLoginPage) {
    if (isLoggedIn) return Response.redirect(new URL("/", req.nextUrl));
    return;
  }
  if (!isLoggedIn) {
    const url = new URL("/masuk", req.nextUrl);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|pdf.worker.min.mjs|icon.svg).*)",
  ],
};
