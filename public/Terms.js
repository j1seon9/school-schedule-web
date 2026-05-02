const TERMS_READ_KEY = "schoolBotTermsReadAt";

      function markTermsReadIfComplete() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        if (scrollTop + viewportHeight < pageHeight - 80) return;

        try {
          localStorage.setItem(TERMS_READ_KEY, String(Date.now()));
        } catch {
          return;
        }
        window.removeEventListener("scroll", markTermsReadIfComplete);
      }

      window.addEventListener("scroll", markTermsReadIfComplete, { passive: true });
      window.addEventListener("load", markTermsReadIfComplete);