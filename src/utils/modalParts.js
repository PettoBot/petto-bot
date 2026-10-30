// The parts of a form (a modal) that people fill in, shared by every feature that shows one: the forms of Petto Code (`cmodal`)
// and the questions of a ticket. One place builds each part the way discord.js and Discord want it (a label over a text input, a
// menu of choices, a pick of users, roles, mentions or channels, a file upload, radio buttons, checkboxes, a text that only
// informs) and one place reads what was submitted, so no feature writes a second copy of either.
const {
  ComponentType, StringSelectMenuBuilder, TextInputBuilder, LabelBuilder, TextDisplayBuilder, UserSelectMenuBuilder, RoleSelectMenuBuilder,
  MentionableSelectMenuBuilder, ChannelSelectMenuBuilder, FileUploadBuilder, RadioGroupBuilder, CheckboxGroupBuilder, CheckboxBuilder,
} = require('discord.js');

/** The part of a form that people fill in, as discord.js builds it (the label and the description go above it, see addModalParts). */
function formInput(field, customId = field.id) {
  const options = (list) => list.map((option) => ({ label: option.label, value: option.value, ...(option.description ? { description: option.description } : {}), ...(option.default ? { default: true } : {}) }));
  const picker = (builder) => {
    builder.setCustomId(customId).setMinValues(field.min).setMaxValues(field.max).setRequired(field.required);
    if (field.placeholder) builder.setPlaceholder(field.placeholder);
    return builder;
  };
  switch (field.type) {
    case 'menu': return picker(new StringSelectMenuBuilder()).addOptions(options(field.options));
    case 'users': return picker(new UserSelectMenuBuilder());
    case 'roles': return picker(new RoleSelectMenuBuilder());
    case 'mentions': return picker(new MentionableSelectMenuBuilder());
    case 'channels': {
      const menu = picker(new ChannelSelectMenuBuilder());
      if (field.channelTypes?.length) menu.setChannelTypes(...field.channelTypes);
      return menu;
    }
    case 'file': return new FileUploadBuilder().setCustomId(customId).setMinValues(field.min).setMaxValues(field.max).setRequired(field.required);
    case 'radio': return new RadioGroupBuilder().setCustomId(customId).setRequired(field.required).setOptions(options(field.options));
    case 'checks': return new CheckboxGroupBuilder().setCustomId(customId).setMinValues(field.min).setMaxValues(field.max).setRequired(field.required).setOptions(options(field.options));
    case 'check': return new CheckboxBuilder().setCustomId(customId).setDefault(Boolean(field.default));
    default: {
      const input = new TextInputBuilder().setCustomId(customId).setStyle(field.style).setRequired(field.required).setMinLength(field.min).setMaxLength(field.max);
      if (field.placeholder) input.setPlaceholder(field.placeholder);
      if (field.value) input.setValue(field.value);
      return input;
    }
  }
}

const LABEL_SETTERS = {
  menu: 'setStringSelectMenuComponent', users: 'setUserSelectMenuComponent', roles: 'setRoleSelectMenuComponent', mentions: 'setMentionableSelectMenuComponent', channels: 'setChannelSelectMenuComponent',
  file: 'setFileUploadComponent', radio: 'setRadioGroupComponent', checks: 'setCheckboxGroupComponent', check: 'setCheckboxComponent',
};

const FIELD_TEXT_MAX = 4000;
const clipField = (value) => String(value ?? '').slice(0, FIELD_TEXT_MAX);

/**
 * What a submitted form holds, for the code: `Fields` (what each part gave: a text, a list of values or of ids, true or false, a list of files), `FieldText`
 * (the same as text to print: ids as mentions, lists joined, ✅ or ❌) and `Files` (every uploaded file of the form, in one list).
 */
function submittedFields(fields) {
  const out = { Fields: {}, FieldText: {}, Files: [] };
  for (const field of fields.values()) {
    const id = field.customId;
    switch (field.type) {
      case ComponentType.TextInput:
        out.Fields[id] = clipField(field.value); out.FieldText[id] = out.Fields[id]; break;
      case ComponentType.RadioGroup:
        out.Fields[id] = clipField(field.value ?? ''); out.FieldText[id] = out.Fields[id]; break;
      case ComponentType.StringSelect: case ComponentType.CheckboxGroup:
        out.Fields[id] = [...field.values].map(clipField); out.FieldText[id] = clipField(out.Fields[id].join(', ')); break;
      case ComponentType.UserSelect:
        out.Fields[id] = [...field.values]; out.FieldText[id] = clipField(out.Fields[id].map((value) => `<@${value}>`).join(' ')); break;
      case ComponentType.RoleSelect:
        out.Fields[id] = [...field.values]; out.FieldText[id] = clipField(out.Fields[id].map((value) => `<@&${value}>`).join(' ')); break;
      case ComponentType.ChannelSelect:
        out.Fields[id] = [...field.values]; out.FieldText[id] = clipField(out.Fields[id].map((value) => `<#${value}>`).join(' ')); break;
      case ComponentType.MentionableSelect:
        out.Fields[id] = [...field.values]; out.FieldText[id] = clipField(out.Fields[id].map((value) => (field.roles?.has(value) ? `<@&${value}>` : `<@${value}>`)).join(' ')); break;
      case ComponentType.Checkbox:
        out.Fields[id] = Boolean(field.value); out.FieldText[id] = field.value ? '✅' : '❌'; break;
      case ComponentType.FileUpload: {
        const files = [...(field.attachments?.values() ?? [])].map((file) => ({ ID: file.id, Name: file.name, URL: file.url, Size: file.size, Type: file.contentType ?? '', Description: file.description ?? '' }));
        out.Fields[id] = files; out.FieldText[id] = clipField(files.map((file) => file.URL).join('\n')); out.Files.push(...files); break;
      }
      default: break;
    }
  }
  return out;
}

/**
 * Adds the parts of a form to a modal builder: every part under its label (and its description), a text that only informs on its own.
 * `fields` are the parts as Petto Code's `ctext`, `cmenu`... make them. Returns the same builder.
 */
function addModalParts(modal, fields) {
  for (const field of fields) {
    if (field.type === 'display') { modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(field.content)); continue; }
    const label = new LabelBuilder().setLabel(field.label);
    if (field.description) label.setDescription(field.description);
    label[LABEL_SETTERS[field.type] ?? 'setTextInputComponent'](formInput(field));
    modal.addLabelComponents(label);
  }
  return modal;
}

module.exports = { formInput, addModalParts, submittedFields, FIELD_TEXT_MAX, clipField };
