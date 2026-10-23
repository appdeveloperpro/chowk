const form = document.querySelector("#admin-login-form");
const errorMessage = document.querySelector("#admin-login-error");
const submitButton = document.querySelector("#admin-login-submit");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  errorMessage.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Verifying access…";

  try {
    const values = new FormData(form);
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: values.get("email"),
        password: values.get("password")
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to sign in");
    window.location.assign("/admin/dashboard");
  } catch (error) {
    errorMessage.textContent = error instanceof Error
      ? error.message
      : "Unable to sign in. Please try again.";
    errorMessage.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Sign in to dashboard";
  }
});
