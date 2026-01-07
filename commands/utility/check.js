// --- UPDATED PARSER WITH BRACE COUNTING ---
function checkSqmContent(content) {

	// 1. ROBUST CLASS EXTRACTOR (Brace Counter)
	// This correctly handles nested classes like 'class Mission' and 'class EditorData'
	const extractClass = (className, fullText) => {
		// Find "class ClassName"
		const classRegex = new RegExp(`class\\s+${className}\\s*`, 'i');
		const match = fullText.match(classRegex);
		if (!match) return null;

		const startIndex = match.index + match[0].length;

		// Find the opening '{'
		let openBraceIndex = fullText.indexOf('{', startIndex);
		if (openBraceIndex === -1) return null;

		// Walk through the string counting braces
		let balance = 1;
		let currentIndex = openBraceIndex + 1;

		while (balance > 0 && currentIndex < fullText.length) {
			const char = fullText[currentIndex];
			if (char === '{') balance++;
			else if (char === '}') balance--;
			currentIndex++;
		}

		if (balance !== 0) return null; // Malformed file

		// Return content WITHOUT the outer braces
		return fullText.substring(openBraceIndex + 1, currentIndex - 1);
	};

	// 2. FIND VALUE Helper
	const findValue = (key, text) => {
		if (!text) return null;
		const regex = new RegExp(`\\b${key}\\b\\s*=\\s*([\\s\\S]*?);`, 'i');
		const match = text.match(regex);
		if (!match) return null;
		return match[1].replace(/"/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
	};

	// 3. EXTRACT ARRAY Helper
	const extractArray = (key, text) => {
		if (!text) return [];
		const regex = new RegExp(`\\b${key}\\[\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`, 'i');
		const match = text.match(regex);
		if (!match) return [];

		const rawList = match[1];
		const items = [];
		const itemRegex = /"([^"]+)"/g;
		let itemMatch;
		while ((itemMatch = itemRegex.exec(rawList)) !== null) {
			items.push(itemMatch[1]);
		}
		return items;
	};

	// --- EXECUTE EXTRACTION ---

	// Scopes (Now using the robust brace counter)
	const scenarioData = extractClass('ScenarioData', content);
	const editorData = extractClass('EditorData', content);

	// 'Intel' is inside 'Mission'. Now that extractClass works on nested blocks,
	// we can properly extract Mission first, then Intel.
	const missionClass = extractClass('Mission', content);
	const missionIntel = extractClass('Intel', missionClass || content);

	// Values
	const author = findValue('author', scenarioData);
	const disabledAI = findValue('disabledAI', scenarioData);
	const overview = findValue('overviewText', scenarioData);
	const title = findValue('briefingName', missionIntel);

	// Arrays
	const edenMods = extractArray('mods', editorData);

	// Filter out A3_ vanilla addons
	const requiredAddons = extractArray('addons', content)
		.filter(addon => !addon.startsWith('A3_'));

	// Composition Check
	const requiredComps = ['BT Ship Comp', 'BT Spawn Comp'];
	let foundComp = null;
	for (const comp of requiredComps) {
		if (new RegExp(`name\\s*=\\s*"${comp}"`, 'i').test(content)) {
			foundComp = comp;
			break;
		}
	}

	return {
		hasAuthor: !!author, author,
		hasTitle: !!title, title,
		aiDisabled: disabledAI === '1',
		hasOverview: !!overview,
		hasComposition: !!foundComp, foundComp,
		edenMods,
		requiredAddons,
	};
}