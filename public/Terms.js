const TERMS_READ_KEY = "schoolBotTermsReadAt";
const TERMS_READ_NONCE_KEY = "schoolBotTermsReadNonce";

      function getRegisterReadNonce() {
        try {
          return new URLSearchParams(window.location.search).get("readNonce") || "";
        } catch {
          return "";
        }
      }

      function getReturnPath() {
        try {
          return new URLSearchParams(window.location.search).get("returnTo") || "/";
        } catch {
          return "/";
        }
      }

      function updateRegisterBackLinks() {
        const readNonce = getRegisterReadNonce();
        const url = new URL(getReturnPath(), window.location.origin);
        if (readNonce) url.searchParams.set("readNonce", readNonce);
        document.querySelectorAll('a[href="/"], a[href="/register"], .legal-back').forEach(link => {
          link.href = `${url.pathname}${url.search}`;
        });
      }

      function markTermsReadIfComplete() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        if (scrollTop + viewportHeight < pageHeight - 80) return;

        try {
          localStorage.setItem(TERMS_READ_KEY, String(Date.now()));
          const readNonce = getRegisterReadNonce();
          if (readNonce) localStorage.setItem(TERMS_READ_NONCE_KEY, readNonce);
        } catch {
          return;
        }
        window.removeEventListener("scroll", markTermsReadIfComplete);
      }

      window.addEventListener("scroll", markTermsReadIfComplete, { passive: true });
      window.addEventListener("load", () => {
        updateRegisterBackLinks();
        markTermsReadIfComplete();
      });
