const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	StringSelectMenuBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} = require('discord.js');

// 1. The Operation Type Dropdown
function buildOpTypeSelect(currentOpType) {
	const typeSelect = new StringSelectMenuBuilder()
		.setCustomId('select_op_type')
		.setPlaceholder('Select Operation Type')
		.addOptions([
			{ label: 'Main Operation', value: 'Main Operation', default: currentOpType === 'Main Operation' },
			{ label: 'Incursion', value: 'Incursion', default: currentOpType === 'Incursion' },
			// Add any future operation types right here!
		]);

	return new ActionRowBuilder().addComponents(typeSelect);
}

// 2. The standard 3-button confirmation row
function buildActionButtons(confirmLabel = 'Confirm & Save') {
	const btnEditDate = new ButtonBuilder().setCustomId('btn_edit_date').setLabel('Edit Date').setStyle(ButtonStyle.Secondary);
	const btnConfirm = new ButtonBuilder().setCustomId('btn_confirm').setLabel(confirmLabel).setStyle(ButtonStyle.Success);
	const btnCancel = new ButtonBuilder().setCustomId('btn_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger);

	return new ActionRowBuilder().addComponents(btnEditDate, btnConfirm, btnCancel);
}

// 3. The Date Editing Modal popup
function buildDateModal(currentDate) {
	const modal = new ModalBuilder().setCustomId('modal_date').setTitle('Edit Operation Date');
	const dateInput = new TextInputBuilder()
		.setCustomId('input_date')
		.setLabel('Format: YYYY-MM-DD')
		.setStyle(TextInputStyle.Short)
		.setValue(currentDate)
		.setMaxLength(10)
		.setMinLength(10);

	modal.addComponents(new ActionRowBuilder().addComponents(dateInput));
	return modal;
}

module.exports = {
	buildOpTypeSelect,
	buildActionButtons,
	buildDateModal,
};