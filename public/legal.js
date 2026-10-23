const policies = [
  {
    path: "/legal/terms-of-use",
    title: "Terms of Use",
    description: "For readers and users of the Chowk News app and website."
  },
  {
    path: "/legal/privacy-policy",
    title: "Privacy Policy",
    description: "How we handle personal data of readers and reporters."
  },
  {
    path: "/legal/corrections-takedown-grievance",
    title: "Corrections, Takedown and Grievance Policy",
    description: "How we fix errors, remove content and handle complaints."
  }
];

const list = document.querySelector("#legal-documents");
const selectedPath = window.location.pathname;
const selectedPolicy = policies.find((policy) => policy.path === selectedPath);

function createPolicyCard(policy, listLink = policy.path) {
  const card = document.createElement("article");
  card.className = "legal-document-card";
  const title = document.createElement("h2");
  title.textContent = policy.title;
  const description = document.createElement("p");
  description.textContent = policy.description;
  const status = document.createElement("span");
  status.className = "legal-document-status";
  status.textContent = "अंतिम समीक्षा के बाद प्रकाशित होगी";
  const link = document.createElement("a");
  link.href = listLink;
  link.textContent = listLink === "/legal" ? "सभी नीतियां देखें" : "स्थिति देखें";
  card.append(title, description, status, link);
  return card;
}

if (selectedPolicy) {
  document.title = `${selectedPolicy.title} — CHOWK NEWS`;
  document.querySelector("#legal-title").textContent = selectedPolicy.title;
  document.querySelector(".catalogue-heading > p:last-child").textContent = selectedPolicy.description;
  list.replaceChildren(createPolicyCard(selectedPolicy, "/legal"));
} else {
  list.replaceChildren(...policies.map((policy) => createPolicyCard(policy)));
}
