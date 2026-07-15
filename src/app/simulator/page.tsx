"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type ChatMessage = {
  id: string;
  phone: string;
  direction: "in" | "out";
  body: string;
  buttons: { id: string; title: string }[] | null;
  createdAt: string;
};

function randomPhone() {
  const n = Math.floor(100000000 + Math.random() * 899999999);
  return `9665${String(n).slice(0, 8)}`;
}

export default function SimulatorPage() {
  const [phones, setPhones] = useState<string[]>([]);
  const [activePhone, setActivePhone] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadPhones = useCallback(async () => {
    const res = await fetch("/api/bot/chat");
    const data = await res.json();
    const list = (data.phones ?? []).map((p: { phone: string }) => p.phone);
    setPhones(list);
    if (!activePhone && list.length) setActivePhone(list[0]);
  }, [activePhone]);

  const loadMessages = useCallback(async (phone: string) => {
    if (!phone) return;
    const res = await fetch(`/api/bot/chat?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    setMessages(data.messages ?? []);
  }, []);

  useEffect(() => {
    loadPhones();
  }, [loadPhones]);

  useEffect(() => {
    if (!activePhone) return;
    loadMessages(activePhone);
    const interval = setInterval(() => loadMessages(activePhone), 2500);
    return () => clearInterval(interval);
  }, [activePhone, loadMessages]);

  const lastMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
    // نسحب لآخر المحادثة بس لو فعلاً وصلت رسالة جديدة (تغيّر آخر ID)، مش في
    // كل مرة الصفحة بتحدّث نفسها كل 2.5 ثانية — عشان متضطرش تفضل ماسك
    // السكرول وأنت بتقرأ رسايل قديمة فوق.
    if (lastId && lastId !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastId;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function send(payload: { text?: string; buttonId?: string }) {
    if (!activePhone) return;
    setSending(true);
    try {
      await fetch("/api/bot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: activePhone, name: name || undefined, ...payload }),
      });
      setText("");
      await loadMessages(activePhone);
      await loadPhones();
    } finally {
      setSending(false);
    }
  }

  function createNewPersona() {
    const phone = randomPhone();
    setPhones((prev) => [phone, ...prev]);
    setActivePhone(phone);
    setMessages([]);
    setName("");
  }

  const lastMessage = messages[messages.length - 1];
  const lastBotButtons =
    lastMessage && lastMessage.direction === "out" && lastMessage.buttons?.length ? lastMessage : null;

  return (
    <div className="grid min-h-screen grid-cols-1 bg-slate-100 md:grid-cols-[280px_1fr]">
      <aside className="border-l border-slate-200 bg-white p-4">
        <a href="/admin" className="text-sm font-medium text-emerald-700 hover:underline">
          ← لوحة الإدارة
        </a>
        <h2 className="mt-4 text-lg font-bold text-slate-900">محاكي واتساب</h2>
        <p className="mt-1 text-xs text-slate-500">
          كل رقم هنا يمثل شخص حقيقي (صاحب معرض أو مندوب) يتحدث مع البوت.
        </p>

        <button
          onClick={createNewPersona}
          className="mt-4 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          + رقم جديد (شخصية جديدة)
        </button>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-600">اسم العرض (اختياري)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: أبو فهد"
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>

        <div className="mt-6 space-y-1">
          <p className="text-xs font-semibold uppercase text-slate-400">الأرقام النشطة</p>
          {phones.map((p) => (
            <button
              key={p}
              onClick={() => setActivePhone(p)}
              className={`block w-full rounded-lg px-3 py-2 text-right font-mono text-sm ${
                p === activePhone ? "bg-emerald-100 text-emerald-800" : "hover:bg-slate-100"
              }`}
            >
              {p}
            </button>
          ))}
          {phones.length === 0 && <p className="text-xs text-slate-400">لا توجد أرقام بعد، أنشئ رقماً جديداً.</p>}
        </div>
      </aside>

      <main className="flex flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <p className="text-sm text-slate-500">المحادثة مع</p>
          <p className="font-mono text-lg font-bold text-slate-900">{activePhone || "اختر رقماً"}</p>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-6">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "in" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-lg rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap shadow-sm ${
                  m.direction === "in"
                    ? "bg-emerald-600 text-white rounded-bl-none"
                    : "bg-white text-slate-800 rounded-br-none border border-slate-200"
                }`}
              >
                {m.body}
              </div>
            </div>
          ))}
          {messages.length === 0 && activePhone && (
            <p className="text-center text-sm text-slate-400">
              ابدأ المحادثة بإرسال أي رسالة، مثل &quot;السلام عليكم&quot;
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {lastBotButtons?.buttons && (
          <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-6 py-3">
            {lastBotButtons.buttons.map((b) => (
              <button
                key={b.id}
                disabled={sending}
                onClick={() => send({ buttonId: b.id })}
                className="rounded-full border border-emerald-600 px-4 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {b.title}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send({ text });
          }}
          className="flex gap-2 border-t border-slate-200 bg-white px-6 py-4"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!activePhone || sending}
            placeholder="اكتب رسالتك هنا... مثال: مطلوب كامري 2025 ابيض الرياض"
            className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={!activePhone || sending || !text.trim()}
            className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            إرسال
          </button>
        </form>
      </main>
    </div>
  );
}
