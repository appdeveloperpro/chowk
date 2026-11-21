const form = document.querySelector("#opinion-submission-form");
const status = document.querySelector("#opinion-submit-status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Sending submission…";
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    body.consent = form.elements.consent.checked;
    body.topic = body.topic?.trim() || "";
    const response = await fetch("/api/opinion-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Submission could not be sent.");
    status.textContent = `Submitted for editorial review. Reference: ${result.data?.reference || "pending"}. Keep this reference for follow-up.`;
    form.reset();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Submission could not be sent.";
  } finally {
    submit.disabled = false;
  }
});
