/**
 * LLM Chat App Frontend (XSS-SAFE)
 *
 * Handles the chat UI interactions and communication with the backend API.
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

// Auto-resize textarea
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send on Enter (no Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button
sendButton.addEventListener("click", sendMessage);

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
		// Create assistant message safely
		const assistantMessageEl = document.createElement("div");
		assistantMessageEl.className = "message assistant-message";

		const assistantTextEl = document.createElement("p");
		assistantMessageEl.appendChild(assistantTextEl);
		chatMessages.appendChild(assistantMessageEl);

		chatMessages.scrollTop = chatMessages.scrollHeight;

		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages: chatHistory }),
		});

		if (!response.ok || !response.body) {
			throw new Error("Failed to get response");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";
		let buffer = "";

		const flush = () => {
			assistantTextEl.textContent = responseText;
			chatMessages.scrollTop = chatMessages.scrollHeight;
		};

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
						flush();
					}
				} catch {
					// Ignore malformed chunks safely
				}
			}
		}

		if (responseText) {
			chatHistory.push({ role: "assistant", content: responseText });
		}
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

/**
 * SAFE message renderer (NO innerHTML)
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;

	const p = document.createElement("p");
	p.textContent = content; // 🔒 XSS FIX

	messageEl.appendChild(p);
	chatMessages.appendChild(messageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * SSE parser
 */
function consumeSseEvents(buffer) {
	const events = [];
	let normalized = buffer.replace(/\r/g, "");
	let idx;

	while ((idx = normalized.indexOf("\n\n")) !== -1) {
		const raw = normalized.slice(0, idx);
		normalized = normalized.slice(idx + 2);

		const dataLines = raw
			.split("\n")
			.filter((l) => l.startsWith("data:"))
			.map((l) => l.slice(5).trimStart());

		if (dataLines.length) {
			events.push(dataLines.join("\n"));
		}
	}
	return { events, buffer: normalized };
}
