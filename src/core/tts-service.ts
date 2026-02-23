/* ==========================================================================
   TTS Service
   Manages text-to-speech playback via OpenRouter's audio API.
   Provides play/stop with button state management.
   ========================================================================== */

import { openRouterService } from './openrouter-service'
import { getSetting } from '../settings'

let currentAudio: HTMLAudioElement | null = null
let currentButton: HTMLElement | null = null
let currentObjectURL: string | null = null

/**
 * Play TTS for the given text. Stops any existing playback first.
 * Updates the button's icon to show loading → stop → speaker states.
 */
export async function playTTS(text: string, button: HTMLElement): Promise<void> {
	// If clicking the same button that's playing, toggle off
	if (currentButton === button && currentAudio && !currentAudio.paused) {
		stopTTS()
		return
	}

	// Stop any existing playback
	stopTTS()

	currentButton = button
	button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'

	try {
		const voice = (() => {
			try {
				return getSetting('ttsVoice') || 'nova'
			} catch {
				return 'nova'
			}
		})()

		const audioData = await openRouterService.textToSpeech(text, voice)

		const blob = new Blob([audioData], { type: 'audio/mpeg' })
		const url = URL.createObjectURL(blob)
		currentObjectURL = url

		const audio = new Audio(url)
		currentAudio = audio

		button.innerHTML = '<i class="fas fa-stop"></i>'

		const cleanup = () => {
			button.innerHTML = '<i class="fas fa-volume-up"></i>'
			if (currentObjectURL === url) {
				URL.revokeObjectURL(url)
				currentObjectURL = null
			}
			if (currentAudio === audio) {
				currentAudio = null
				currentButton = null
			}
		}

		audio.addEventListener('ended', cleanup)
		audio.addEventListener('error', cleanup)

		await audio.play()
	} catch (err: any) {
		button.innerHTML = '<i class="fas fa-volume-up"></i>'
		currentAudio = null
		currentButton = null
		if (currentObjectURL) {
			URL.revokeObjectURL(currentObjectURL)
			currentObjectURL = null
		}
		throw err
	}
}

/**
 * Stop any currently playing TTS audio and reset button state.
 */
export function stopTTS(): void {
	if (currentAudio) {
		currentAudio.pause()
		currentAudio.currentTime = 0
		currentAudio = null
	}
	if (currentButton) {
		currentButton.innerHTML = '<i class="fas fa-volume-up"></i>'
		currentButton = null
	}
	if (currentObjectURL) {
		URL.revokeObjectURL(currentObjectURL)
		currentObjectURL = null
	}
}
