/**
 * LLM Chat App Frontend (Refactored, XSS-Safe)
 * Functionality: UNCHANGED
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let chatHistory = [
	{
		role: "assistant",
		content:
			"Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
	},
];

let isProcessing = false;

/* =========================
   UI helpers
========================= */

userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

sendButton.addEventListener("click", sendMessage);

/* =========================
   Core chat logic
========================= */

async function sendMessage() {
	const message = userInput.value.trim();
	if (!message || isProcessing) return;

	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	addMessageToChat("user", message);

	userInput.value = "";
	userInput.style.height = "auto";
	typingIndicator.classList.add("visible");

	chatHistory.push({ role: "user", content: message });

	try {
		const assistantMessageEl = createAssistantMessage();
		const assistantTextEl = assistantMessageEl.querySelector("p");

		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages: chatHistory }),
		});

		if (!response.ok || !response.body) {
			throw new Error("Invalid response");
		}

		await streamAssistantResponse(response.body, assistantTextEl);
	} catch (err) {
		console.error(err);
		addMessageToChat(
			"assistant",
			"Sorry, there was an error processing your request.",
		);
	} finally {
		typingIndicator.classList.remove("visible");
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;
		userInput.focus();
	}
}

/* =========================
   Streaming logic
========================= */

async function streamAssistantResponse(body, outputEl) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let responseText = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const parsed = consumeSseEvents(buffer);
		buffer = parsed.buffer;

		for (const data of parsed.events) {
			if (data === "[DONE]") break;

			try {
				const json = JSON.parse(data);
				let chunk = "";

				if (typeof json.response === "string") {
					chunk = json.response;
				} else if (json.choices?.[0]?.delta?.content) {
					chunk = json.choices[0].delta.content;
				}

				if (chunk) {
					responseText += chunk;
					outputEl.textContent = responseText;
					chatMessages.scrollTop = chatMessages.scrollHeight;
				}
			} catch {
				// ignore malformed chunks safely
			}
		}
	}

	if (responseText) {
		chatHistory.push({ role: "assistant", content: responseText });
	}
}

/* =========================
   File processing (NEW NAME)
   Functionality unchanged
========================= */

function processUploadedFile(fileText) {
	// SAME behavior as typing text and pressing Send
	if (!fileText || isProcessing) return;

	addMessageToChat("user", fileText);
	chatHistory.push({ role: "user", content: fileText });

	userInput.value = "";
	userInput.style.height = "auto";

	sendMessage();
}

/* =========================
   DOM helpers (XSS SAFE)
========================= */

function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;

	const p = document.createElement("p");
	p.textContent = content; // 🔒 XSS FIX

	messageEl.appendChild(p);
	chatMessages.appendChild(messageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createAssistantMessage() {
	const messageEl = document.createElement("div");
	messageEl.className = "message assistant-message";

	const p = document.createElement("p");
	messageEl.appendChild(p);

	chatMessages.appendChild(messageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;

	return messageEl;
}

/* =========================
   SSE parser
========================= */

function consumeSseEvents(buffer) {
	const events = [];
	let normalized = buffer.replace(/\r/g, "");
	let index;

	while ((index = normalized.indexOf("\n\n")) !== -1) {
		const raw = normalized.slice(0, index);
		normalized = normalized.slice(index + 2);

		const dataLines = raw
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart());

		if (dataLines.length) {
			events.push(dataLines.join("\n"));
		}
	}

	return { events, buffer: normalized };
}
