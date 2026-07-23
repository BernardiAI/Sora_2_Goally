export type PromptCharacter = {
  name: string;
  description?: string;
};

export type SoraPromptInput = {
  prompt: string;
  dialogue?: string;
  audioDirection?: string;
  characters?: PromptCharacter[];
  extractedCharacters?: PromptCharacter[];
  extractedCharacterName?: string;
  consistencyGuardrails?: boolean;
};

export type ContinuityPromptInput = SoraPromptInput & {
  mode: "extend" | "edit";
};

function clean(value?: string) {
  return value?.trim().replace(/\r\n/g, "\n") ?? "";
}

export function validateDialogue(dialogue?: string) {
  const lines = clean(dialogue).split("\n").map((line) => line.trim()).filter(Boolean);
  const invalid = lines.find((line) => !/^(?:-\s*)?[^:]{1,80}:\s*\S/.test(line));
  return invalid
    ? "Write each dialogue line as Speaker: “spoken line” so Sora can keep turns assigned."
    : null;
}

export function buildSoraPrompt(input: SoraPromptInput) {
  const sections = [clean(input.prompt)];
  const characters = input.characters ?? [];
  const extractedName = clean(input.extractedCharacterName);
  const extractedCharacters = [
    ...(input.extractedCharacters ?? []),
    ...(extractedName ? [{ name: extractedName }] : []),
  ];

  if (characters.length || extractedCharacters.length) {
    const lines = characters.map((character) =>
      `- ${clean(character.name)}${clean(character.description) ? `: ${clean(character.description)}` : ""}`,
    );
    lines.push(...extractedCharacters.map((character) =>
      `- ${clean(character.name)}: ${clean(character.description) || "preserve the uploaded character asset's visual identity and proportions."}`,
    ));
    sections.push([
      "Character continuity:",
      ...lines,
      "Use these exact character names throughout the shot. Keep each named character's appearance, wardrobe, proportions, and role stable.",
    ].join("\n"));
  }

  const audioDirection = clean(input.audioDirection);
  if (audioDirection) sections.push(`Audio direction:\n${audioDirection}`);

  const dialogue = clean(input.dialogue);
  if (dialogue) {
    const lines = dialogue.split("\n").map((line) => line.trim()).filter(Boolean).map((line) =>
      line.startsWith("-") ? line : `- ${line}`,
    );
    sections.push([
      "<dialogue>",
      ...lines,
      "</dialogue>",
      "Only the labeled speaker says each line. Keep voices distinct and do not swap, duplicate, paraphrase, or add dialogue.",
    ].join("\n"));
  }

  if (input.consistencyGuardrails !== false) {
    sections.push([
      "Continuity and behavior constraints:",
      "- Keep the requested subject count, identities, anatomy, clothing, props, handedness, and spatial relationships stable.",
      "- Use one clear subject action and one clear camera move at a time.",
      "- Do not invent extra characters, limbs, props, narration, on-screen text, scene changes, or unrequested actions.",
      "- Favor physically plausible motion and preserve cause-and-effect between action beats.",
    ].join("\n"));
  }

  return sections.filter(Boolean).join("\n\n");
}

export function buildContinuityPrompt(input: ContinuityPromptInput) {
  const instruction = input.mode === "extend"
    ? [
        "Continue the supplied Sora video directly from its final moment.",
        "Preserve the same characters, faces, body proportions, wardrobe, props, voices, environment, lighting logic, camera language, and spatial layout.",
        "Do not restart, recap, cut back to an earlier moment, or introduce a new establishing shot.",
        `New continuation: ${clean(input.prompt)}`,
      ].join("\n")
    : [
        "Make one targeted edit to the supplied Sora video.",
        "Preserve its duration, timing, character identities, faces, body proportions, wardrobe, voices, environment, camera movement, composition, and every detail not explicitly changed below.",
        "Do not redesign the scene or add new actions, dialogue, people, objects, cuts, or camera moves.",
        `Change only: ${clean(input.prompt)}`,
      ].join("\n");

  return buildSoraPrompt({ ...input, prompt: instruction });
}
