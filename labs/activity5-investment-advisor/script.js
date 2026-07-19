/*
 * Webhook configuration.
 *
 * You do NOT need to edit this file. Paste your n8n Production webhook URL
 * into the dark setup bar at the bottom of the page and click Save — it is
 * stored in this browser (localStorage) and survives a page reload.
 *
 * Optionally pre-fill it here so the page ships ready-to-run:
 */
const DEFAULT_WEBHOOK_URL = "";

const WEBHOOK_STORAGE_KEY = "investmentAdvisor.webhookUrl";

function readStoredWebhook() {
  try {
    return window.localStorage.getItem(WEBHOOK_STORAGE_KEY) || "";
  } catch (error) {
    // localStorage is unavailable on some file:// / private-mode setups.
    return "";
  }
}

function writeStoredWebhook(url) {
  try {
    if (url) {
      window.localStorage.setItem(WEBHOOK_STORAGE_KEY, url);
    } else {
      window.localStorage.removeItem(WEBHOOK_STORAGE_KEY);
    }
  } catch (error) {
    /* Non-fatal: the URL still works for this page session. */
  }
}

let webhookUrl = readStoredWebhook() || DEFAULT_WEBHOOK_URL;

/*
 * The workflow has TWO webhook triggers on separate paths:
 *   .../webhook/investment-enquiry  -> emails the advisor
 *   .../webhook/investment-chat     -> the AI agent
 * The learner pastes EITHER one; we swap the last path segment to reach the
 * other, so there is only ever one field to fill in.
 */
function webhookFor(kind) {
  if (!webhookUrl) {
    throw new Error(
      "No webhook URL set. Open the setup bar at the bottom of the page and paste your n8n Production URL."
    );
  }

  const wanted = kind === "enquiry" ? "investment-enquiry" : "investment-chat";

  try {
    const url = new URL(webhookUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length) {
      segments[segments.length - 1] = wanted;
      url.pathname = `/${segments.join("/")}`;
      return url.toString();
    }
  } catch (error) {
    /* Fall through and use the URL exactly as pasted. */
  }

  return webhookUrl;
}

const enquiryForm = document.querySelector("#enquiryForm");
const formStatus = document.querySelector("#formStatus");
const chatToggle = document.querySelector("#chatToggle");
const chatWindow = document.querySelector("#chatWindow");
const chatClose = document.querySelector("#chatClose");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatHistory = document.querySelector("#chatHistory");
const chatContact = {
  name: "",
  phone: "",
  email: "",
};
let chatStep = "name";

/*
 * Turn a fetch failure into something a learner can act on. A silent
 * "please try again" hides the three mistakes that actually cause this:
 * no URL set, workflow not active, or CORS not opened up.
 */
function describeWebhookError(error) {
  const message = String((error && error.message) || error);

  if (message.startsWith("No webhook URL set")) {
    return message;
  }

  if (message.includes("404")) {
    return "404 — n8n did not recognise this webhook. Check the workflow is Active and that you used the Production URL, not the Test URL.";
  }

  if (message.includes("Webhook returned")) {
    return `${message}. Check the n8n execution log for this workflow.`;
  }

  return "Could not reach the webhook. Most often this is CORS — in the n8n Webhook node set Allowed Origins (CORS) to *, then Save and re-activate the workflow.";
}

function setFormStatus(message, type) {
  formStatus.textContent = message;
  formStatus.className = `form-status ${type || ""}`.trim();
}

enquiryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submitButton = enquiryForm.querySelector("button[type='submit']");
  const formData = new FormData(enquiryForm);
  const params = new URLSearchParams({ type: "enquiry" });

  for (const [key, value] of formData.entries()) {
    params.set(key, String(value).trim());
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";
  setFormStatus("", "");

  try {
    const url = webhookFor("enquiry");

    // Sent as a POST with a JSON body so the enquiry form and the chatbot use
    // the SAME webhook method. A Webhook node set to POST would 404 a GET.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify(Object.fromEntries(params)),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }

    setFormStatus("Thank you. Your enquiry has been received.", "success");
    enquiryForm.reset();
  } catch (error) {
    setFormStatus(describeWebhookError(error), "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit Enquiry";
  }
});

function openChat() {
  chatWindow.hidden = false;
  chatToggle.hidden = true;
  chatToggle.setAttribute("aria-expanded", "true");
  window.setTimeout(() => chatInput.focus(), 80);
}

function closeChat() {
  chatWindow.hidden = true;
  chatToggle.hidden = false;
  chatToggle.setAttribute("aria-expanded", "false");
}

function appendMessage(text, sender, extraClass) {
  const message = document.createElement("div");
  message.className = ["chat-message", sender, extraClass].filter(Boolean).join(" ");
  message.textContent = text;
  chatHistory.appendChild(message);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return message;
}

function updateChatPrompt() {
  const prompts = {
    name: "Enter your full name...",
    phone: "Enter your phone number...",
    email: "Enter your email address...",
    question: "Type your investment question...",
  };
  chatInput.placeholder = prompts[chatStep];
  chatInput.type = chatStep === "email" ? "email" : chatStep === "phone" ? "tel" : "text";
  chatInput.autocomplete =
    chatStep === "email" ? "email" : chatStep === "phone" ? "tel" : "off";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function readWebhookReply(response) {
  const fallback = "Thank you. Our advisor will get back to you shortly.";
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await response.json();
    return data.reply || data.message || fallback;
  }

  const text = (await response.text()).trim();
  if (!text) {
    return fallback;
  }

  try {
    const data = JSON.parse(text);
    return data.reply || data.message || fallback;
  } catch (error) {
    return text;
  }
}

chatToggle.addEventListener("click", openChat);
chatClose.addEventListener("click", closeChat);

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  appendMessage(message, "user");
  chatInput.value = "";

  if (chatStep === "name") {
    chatContact.name = message;
    chatStep = "phone";
    appendMessage("Thank you. What phone number can our advisor use to reach you?", "bot");
    updateChatPrompt();
    chatInput.focus();
    return;
  }

  if (chatStep === "phone") {
    chatContact.phone = message;
    chatStep = "email";
    appendMessage("Thanks. Please share your email address as well.", "bot");
    updateChatPrompt();
    chatInput.focus();
    return;
  }

  if (chatStep === "email") {
    if (!isValidEmail(message)) {
      appendMessage("Please enter a valid email address so our advisor can follow up.", "bot");
      chatInput.focus();
      return;
    }

    chatContact.email = message;
    chatStep = "question";
    appendMessage(
      "Thank you. I have your contact details. What investment planning question can I help with?",
      "bot"
    );
    updateChatPrompt();
    chatInput.focus();
    return;
  }

  chatInput.disabled = true;
  const sendButton = chatForm.querySelector("button");
  sendButton.disabled = true;
  const loadingMessage = appendMessage("Thinking...", "bot", "loading");

  try {
    const response = await fetch(webhookFor("chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        type: "chat",
        message,
        name: chatContact.name,
        phone: chatContact.phone,
        email: chatContact.email,
        source: "investment-advisor-website",
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }

    loadingMessage.textContent = await readWebhookReply(response);
    loadingMessage.classList.remove("loading");
  } catch (error) {
    loadingMessage.textContent = describeWebhookError(error);
    loadingMessage.classList.remove("loading");
    loadingMessage.classList.add("error");
  } finally {
    chatInput.disabled = false;
    sendButton.disabled = false;
    chatInput.focus();
  }
});

/* ---- Webhook setup bar ---- */

const webhookBar = document.querySelector("#webhookBar");
const webhookInput = document.querySelector("#webhookUrl");
const webhookSave = document.querySelector("#webhookSave");
const webhookTest = document.querySelector("#webhookTest");
const webhookClear = document.querySelector("#webhookClear");
const webhookStatus = document.querySelector("#webhookStatus");
const webhookToggle = document.querySelector("#webhookToggle");

function setWebhookStatus(message, type) {
  webhookStatus.textContent = message;
  webhookStatus.className = `webhook-status ${type || ""}`.trim();
}

function looksLikeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function applyWebhookUrl(value, { persist } = { persist: true }) {
  const trimmed = value.trim().replace(/\s+/g, "");

  if (!trimmed) {
    webhookUrl = "";
    if (persist) writeStoredWebhook("");
    setWebhookStatus("Webhook URL cleared.", "");
    return false;
  }

  if (!looksLikeUrl(trimmed)) {
    setWebhookStatus("That does not look like a URL. It should start with http:// or https://", "error");
    return false;
  }

  webhookUrl = trimmed;
  webhookInput.value = trimmed;
  if (persist) writeStoredWebhook(trimmed);
  setWebhookStatus("Webhook URL saved. The form and chatbot will now use it.", "success");
  return true;
}

webhookSave.addEventListener("click", () => applyWebhookUrl(webhookInput.value));

webhookInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyWebhookUrl(webhookInput.value);
  }
});

webhookClear.addEventListener("click", () => {
  webhookInput.value = "";
  applyWebhookUrl("");
});

webhookTest.addEventListener("click", async () => {
  if (!applyWebhookUrl(webhookInput.value)) {
    return;
  }

  webhookTest.disabled = true;
  setWebhookStatus("Testing webhook...", "pending");

  try {
    const response = await fetch(webhookFor("chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        type: "chat",
        message: "Connection test from the Investment Advisor website.",
        name: "Test",
        phone: "",
        email: "",
        source: "webhook-test",
      }),
    });

    if (response.ok) {
      setWebhookStatus(
        `Success — n8n responded with ${response.status}. Your webhook is live.`,
        "success"
      );
    } else if (response.status === 404) {
      setWebhookStatus(
        "404 — n8n did not recognise this URL. Check the workflow is Active and that you copied the Production URL (not the Test URL).",
        "error"
      );
    } else {
      setWebhookStatus(`n8n responded with ${response.status}.`, "error");
    }
  } catch (error) {
    setWebhookStatus(
      "Could not reach the webhook. Most often this is CORS — in the n8n Webhook node set Allowed Origins (CORS) to *, then Save and re-activate.",
      "error"
    );
  } finally {
    webhookTest.disabled = false;
  }
});

webhookToggle.addEventListener("click", () => {
  const collapsed = webhookBar.classList.toggle("collapsed");
  webhookToggle.textContent = collapsed ? "Webhook setup" : "Hide setup";
  webhookToggle.setAttribute("aria-expanded", String(!collapsed));
});

if (webhookUrl) {
  webhookInput.value = webhookUrl;
  setWebhookStatus("Using the saved webhook URL. Click Test to verify it.", "");
  webhookBar.classList.add("collapsed");
  webhookToggle.textContent = "Webhook setup";
  webhookToggle.setAttribute("aria-expanded", "false");
} else {
  setWebhookStatus("Paste your n8n Production webhook URL to activate the form and chatbot.", "");
}
