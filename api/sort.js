// Vercel serverless function: POST /api/sort
// Sends a batch of hand-gesture images to Claude (vision) and returns a label
// per image as structured JSON. Requires env var ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";

// Structured-output schema: one labeled result per image.
const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          confidence: { type: "number" },
          note: { type: "string" },
        },
        required: ["id", "label", "confidence", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

function parseDataUrl(d) {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(d || "");
  if (!m) return null;
  let media = m[1].toLowerCase();
  if (media === "image/jpg") media = "image/jpeg";
  return { media_type: media, data: m[2] };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.",
    });
    return;
  }

  try {
    const { images, categories } = req.body || {};
    if (!Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: "images[] is required" });
      return;
    }
    if (images.length > 20) {
      res.status(400).json({ error: "Max 20 images per request — send in batches of 20." });
      return;
    }

    const cats = Array.isArray(categories) ? categories.filter(Boolean) : [];
    const content = [
      {
        type: "text",
        text:
          "You sort images of human HAND GESTURES for a robot-training dataset.\n" +
          "For EACH image return one object with:\n" +
          "- id: the exact id given for that image\n" +
          '- label: the best gesture category (lowercase, short, e.g. "grab", "open-palm", "point", "thumbs-up"). ' +
          (cats.length
            ? `Prefer these existing categories when one fits: ${cats.join(", ")}. If none fit, propose a concise new lowercase name.`
            : "Propose a concise lowercase name.") +
          "\n- confidence: 0..1\n- note: a few words on what you see\n" +
          'If there is no clear hand or the gesture is unreadable, use label "uncategorized".\n' +
          "Return exactly one result per image.",
      },
    ];

    for (let i = 0; i < images.length; i++) {
      const p = parseDataUrl(images[i] && images[i].dataUrl);
      if (!p) {
        res.status(400).json({ error: `Image ${i + 1} is not a valid base64 image data URL` });
        return;
      }
      const id = String((images[i] && images[i].id) ?? `img-${i}`);
      content.push({ type: "text", text: `Image ${i + 1} — id=${id}:` });
      content.push({ type: "image", source: { type: "base64", media_type: p.media_type, data: p.data } });
    }

    const client = new Anthropic(); // reads ANTHROPIC_API_KEY
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    });

    const text = response.content.find((b) => b.type === "text")?.text || "{}";
    const parsed = JSON.parse(text);
    res.status(200).json({ results: parsed.results || [], usage: response.usage });
  } catch (e) {
    const status = Number.isInteger(e?.status) ? e.status : 500;
    res.status(status).json({ error: e?.message || String(e) });
  }
}
