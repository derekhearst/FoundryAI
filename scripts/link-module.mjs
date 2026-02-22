/**
 * Creates a symlink from Foundry VTT's modules directory to this project's dist/ folder.
 *
 * Usage:
 *   bun run link                               # auto-detect Foundry data path
 *   bun run link -- "D:/FoundryData"           # explicit data path
 *   bun run link -- --remove                   # remove the symlink
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const MODULE_ID = 'foundry-ai'

// Common Foundry VTT data paths per platform
function getDefaultDataPaths() {
	const home = process.env.USERPROFILE || process.env.HOME || ''
	return [
		// Windows
		path.join(process.env.LOCALAPPDATA || '', 'FoundryVTT', 'Data'),
		// macOS
		path.join(home, 'Library', 'Application Support', 'FoundryVTT', 'Data'),
		// Linux
		path.join(home, '.local', 'share', 'FoundryVTT', 'Data'),
		// Alternate local
		path.join(home, 'FoundryVTT', 'Data'),
	]
}

function findFoundryData() {
	for (const p of getDefaultDataPaths()) {
		if (fs.existsSync(path.join(p, 'modules'))) return p
	}
	return null
}

const args = process.argv.slice(2)
const distDir = path.resolve(import.meta.dirname, '..', 'dist')

if (args.includes('--remove')) {
	// Remove mode
	const dataPath = findFoundryData()
	if (!dataPath) {
		console.error('Could not find Foundry VTT data directory. Provide the path as an argument.')
		process.exit(1)
	}
	const linkPath = path.join(dataPath, 'modules', MODULE_ID)
	if (fs.existsSync(linkPath)) {
		fs.rmSync(linkPath, { recursive: true })
		console.log(`✔ Removed ${linkPath}`)
	} else {
		console.log(`Nothing to remove — ${linkPath} does not exist.`)
	}
	process.exit(0)
}

// Resolve Foundry data path
let dataPath = args.find((a) => !a.startsWith('--'))
if (dataPath) {
	if (!fs.existsSync(path.join(dataPath, 'modules'))) {
		console.error(`No "modules" folder found in "${dataPath}". Is this your Foundry Data path?`)
		process.exit(1)
	}
} else {
	dataPath = findFoundryData()
	if (!dataPath) {
		console.error(
			'Could not auto-detect Foundry VTT data directory.\n' +
				'Please provide the path:\n' +
				`  bun run link -- "C:/Users/YourName/AppData/Local/FoundryVTT/Data"`,
		)
		process.exit(1)
	}
}

const modulesDir = path.join(dataPath, 'modules')
const linkPath = path.join(modulesDir, MODULE_ID)

// Ensure dist/ exists
if (!fs.existsSync(distDir)) {
	console.error('dist/ folder not found. Run "bun run build" first.')
	process.exit(1)
}

// Remove existing
if (fs.existsSync(linkPath)) {
	fs.rmSync(linkPath, { recursive: true })
	console.log(`Removed existing ${linkPath}`)
}

// Create junction (works without admin on Windows)
if (process.platform === 'win32') {
	execSync(`mklink /J "${linkPath}" "${distDir}"`, { stdio: 'pipe' })
} else {
	fs.symlinkSync(distDir, linkPath, 'dir')
}

console.log(`✔ Linked: ${linkPath} → ${distDir}`)
console.log(`\nNow start Foundry VTT and enable "${MODULE_ID}" in your world's Module Management.`)
