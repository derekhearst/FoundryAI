/* ==========================================================================
   TTS Service
   Manages text-to-speech playback via browser Speech Synthesis API.
   Provides play/stop with button state management.
   ========================================================================== */

let currentUtterance: SpeechSynthesisUtterance | null = null
let currentButton: HTMLElement | null = null

/**
 * Play TTS for the given text using the browser's Speech Synthesis API.
 * Stops any existing playback first.
 * Updates the button's icon to show stop → speaker states.
 */
export async function playTTS(text: string, button: HTMLElement): Promise<void> {
	// If clicking the same button that's playing, toggle off
	if (currentButton === button && speechSynthesis.speaking) {
		stopTTS()
		return
	}

	// Stop any existing playback
	stopTTS()

	if (!('speechSynthesis' in window)) {
		console.warn('FoundryAI | Speech Synthesis not supported in this browser')
		throw new Error('Text-to-speech is not supported in this browser')
	}

	currentButton = button
	button.innerHTML = '<i class="fas fa-stop"></i>'

	try {
		const utterance = new SpeechSynthesisUtterance(text)
		currentUtterance = utterance

		// Try to pick a good English voice
		const voices = speechSynthesis.getVoices()
		const preferred = voices.find(
			(v) =>
				v.lang.startsWith('en') &&
				(v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Natural')),
		)
		if (preferred) utterance.voice = preferred
		utterance.rate = 1.0
		utterance.pitch = 1.0

		const cleanup = () => {
			button.innerHTML = '<i class="fas fa-volume-up"></i>'
			if (currentUtterance === utterance) {
				currentUtterance = null
				currentButton = null
			}
		}

		utterance.onend = cleanup
		utterance.onerror = cleanup

		speechSynthesis.speak(utterance)
		console.log('FoundryAI | TTS playing via browser Speech Synthesis')
	} catch (err: any) {
		button.innerHTML = '<i class="fas fa-volume-up"></i>'
		currentUtterance = null
		currentButton = null
		throw err
	}
}

/**
 * Stop any currently playing TTS audio and reset button state.
 */
export function stopTTS(): void {
	if (speechSynthesis.speaking || speechSynthesis.pending) {
		speechSynthesis.cancel()
	}
	currentUtterance = null
	if (currentButton) {
		currentButton.innerHTML = '<i class="fas fa-volume-up"></i>'
		currentButton = null
	}
}
