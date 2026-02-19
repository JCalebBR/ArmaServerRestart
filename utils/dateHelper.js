function getLocalOperationDate(dateObject) {
	// 'America/Sao_Paulo' forces the conversion to Brazil time (UTC-3)
	const tzString = dateObject.toLocaleString('en-US', { timeZone: 'America/New_York' });
	const tzDate = new Date(tzString);

	const year = tzDate.getFullYear();
	const month = String(tzDate.getMonth() + 1).padStart(2, '0');
	const day = String(tzDate.getDate()).padStart(2, '0');

	return `${year}-${month}-${day}`;
}

function getDayOfWeekAndType(dateString) {
	// We append T12:00:00 so JavaScript parses it at noon, avoiding any weird midnight timezone shifts
	const d = new Date(`${dateString}T12:00:00`);
	const dayOfWeek = d.toLocaleString('en-US', { weekday: 'long' });

	// Auto-detect! If Wednesday or Sunday, it's a Main Op. Otherwise, Incursion.
	const opType = (dayOfWeek === 'Wednesday' || dayOfWeek === 'Sunday') ? 'Main Operation' : 'Incursion';

	return { dayOfWeek, opType };
}

module.exports = {
	getLocalOperationDate,
	getDayOfWeekAndType,
};