import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { site } from "@/lib/site";

function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return site.allowedDomains.some((d) => e.endsWith("@" + d));
}

const providers = [Google];

// Optional provider: only enabled when its env vars are set, so a partially
// configured deployment (Google only) keeps working.
if (
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
) {
  providers.push(
    MicrosoftEntraID({
      issuer: "https://login.microsoftonline.com/common/v2.0",
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  pages: {
    signIn: "/masuk",
    error: "/masuk",
  },
  session: { strategy: "jwt" },
  callbacks: {
    // Server-side domain enforcement: only Undip email domains may sign in.
    signIn({ profile, account }) {
      const email = profile?.email?.toLowerCase();
      if (!isAllowedEmail(email)) return false;
      if (account?.provider === "google") {
        const p = profile as { email_verified?: boolean };
        if (p.email_verified === false) return false;
      }
      return true;
    },
  },
});
