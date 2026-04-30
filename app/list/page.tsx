"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

type Caption = {
  id: string;
  content: string;
  like_count: number;
  created_datetime_utc: string;
  image_id: string | null;
  images: { url: string } | null;
};

type VoteMap = Record<string, number>;

const API_BASE = "https://api.almostcrackd.ai";

export default function ListPage() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [votes, setVotes] = useState<VoteMap>({});
  const [loading, setLoading] = useState(true);
  const [uploadStep, setUploadStep] = useState<string | null>(null);
  const [generatedCaptions, setGeneratedCaptions] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      const { data: captionData } = await supabase
        .from("captions")
        .select("id, content, like_count, created_datetime_utc, image_id, images(url)")
        .order("like_count", { ascending: false })
        .limit(20);
      setCaptions((captionData as Caption[]) ?? []);
      if (user) {
        const { data: voteData } = await supabase
          .from("caption_votes")
          .select("caption_id, vote_value")
          .eq("created_by_user_id", user.id);
        const voteMap: VoteMap = {};
        for (const v of voteData ?? []) voteMap[v.caption_id] = v.vote_value;
        setVotes(voteMap);
      }
      setLoading(false);
    };
    init();
  }, []);

  const handleVote = async (captionId: string, value: 1 | -1) => {
    if (!user) { alert("Please sign in to vote."); return; }
    const existing = votes[captionId];
    if (existing === value) return;
    const { error } = await supabase.from("caption_votes").insert({
      caption_id: captionId,
      vote_value: value,
      profile_id: user.id,
      created_by_user_id: user.id,
      modified_by_user_id: user.id,
      is_from_study: false,
    });
    if (error) { alert("Failed to submit vote: " + error.message); return; }
    setVotes((prev) => ({ ...prev, [captionId]: value }));
    setCaptions((prev) => prev.map((c) => {
      if (c.id !== captionId) return c;
      return { ...c, like_count: c.like_count + (value - (existing ?? 0)) };
    }));
  };

  const handleImageUpload = async (file: File) => {
    if (!user) { alert("Please sign in to generate captions."); return; }
    setUploadError(null);
    setGeneratedCaptions([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const authHeaders = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };

      setUploadStep("Step 1/4: Getting upload URL...");
      const presignRes = await fetch(`${API_BASE}/pipeline/generate-presigned-url`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error(`Presign failed: ${await presignRes.text()}`);
      const { presignedUrl, cdnUrl } = await presignRes.json();

      setUploadStep("Step 2/4: Uploading image...");
      const uploadRes = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);

      setUploadStep("Step 3/4: Registering image...");
      const registerRes = await fetch(`${API_BASE}/pipeline/upload-image-from-url`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ imageUrl: cdnUrl, isCommonUse: false }),
      });
      if (!registerRes.ok) throw new Error(`Register failed: ${await registerRes.text()}`);
      const { imageId } = await registerRes.json();

      setUploadStep("Step 4/4: Generating captions...");
      const captionRes = await fetch(`${API_BASE}/pipeline/generate-captions`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ imageId }),
      });
      if (!captionRes.ok) throw new Error(`Caption generation failed: ${await captionRes.text()}`);
      const captionData = await captionRes.json();
      const texts: string[] = (Array.isArray(captionData) ? captionData : [captionData])
        .map((c: Record<string, string>) => c.content ?? c.caption ?? JSON.stringify(c))
        .filter(Boolean);
      setGeneratedCaptions(texts);
      setUploadStep(null);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Something went wrong");
      setUploadStep(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0e0e0f] text-white" style={{ fontFamily: "'Georgia', serif" }}>
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">😂 Caption Rater</h1>
          <p className="text-sm text-white/40 mt-0.5">Vote on the funniest captions</p>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-white/50 hidden sm:block">{user.email}</span>
              <button onClick={async () => { await supabase.auth.signOut(); setUser(null); setVotes({}); }}
                className="text-sm px-4 py-2 rounded-full border border-white/20 hover:border-white/40 transition-colors">Sign out</button>
            </>
          ) : (
            <button onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } })}
              className="text-sm px-5 py-2 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-colors">Sign in with Google</button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <section>
          <h2 className="text-lg font-semibold mb-1 text-white/80">Generate a Caption</h2>
          {!user && <p className="text-sm text-white/30 mb-3">Sign in to generate captions from your images</p>}
          <div
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleImageUpload(f); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-2xl p-10 text-center transition-all ${dragOver ? "border-white/60 bg-white/5" : "border-white/20 hover:border-white/40"} ${!user ? "opacity-40 pointer-events-none" : ""}`}
          >
            <input ref={fileRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
            {uploadStep ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <p className="text-white/60 text-sm">{uploadStep}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="text-3xl">🖼️</span>
                <p className="text-white/60 text-sm">Drop an image here or click to upload</p>
                <p className="text-white/30 text-xs">JPEG, PNG, WEBP, GIF, HEIC supported</p>
              </div>
            )}
          </div>
          {generatedCaptions.length > 0 && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-white/40 uppercase tracking-widest">Generated Captions</p>
              {generatedCaptions.map((cap, i) => (
                <div key={i} className="p-5 rounded-2xl bg-white/5 border border-white/10">
                  <p className="text-white text-base leading-relaxed">"{cap}"</p>
                </div>
              ))}
            </div>
          )}
          {uploadError && (
            <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{uploadError}</div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-4 text-white/80">Top Captions</h2>
          {loading ? (
            <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>
          ) : (
            <div className="space-y-4">
              {captions.map((caption) => {
                const userVote = votes[caption.id];
                const imageUrl = caption.images?.url ?? null;
                return (
                  <div key={caption.id} className="rounded-2xl bg-white/[0.03] border border-white/[0.07] hover:border-white/20 transition-all overflow-hidden">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt="caption image"
                        className="w-full max-h-72 object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    <div className="flex items-start gap-5 p-5">
                      <div className="flex flex-col items-center gap-1 pt-0.5 min-w-[44px]">
                        <button onClick={() => handleVote(caption.id, 1)} disabled={!user} title={user ? "Upvote" : "Sign in to vote"}
                          className={`text-xl transition-transform hover:scale-125 disabled:opacity-25 disabled:cursor-not-allowed ${userVote === 1 ? "opacity-100" : "opacity-40 hover:opacity-80"}`}>👍</button>
                        <span className={`text-sm font-bold tabular-nums ${caption.like_count > 0 ? "text-green-400" : caption.like_count < 0 ? "text-red-400" : "text-white/40"}`}>
                          {caption.like_count}
                        </span>
                        <button onClick={() => handleVote(caption.id, -1)} disabled={!user} title={user ? "Downvote" : "Sign in to vote"}
                          className={`text-xl transition-transform hover:scale-125 disabled:opacity-25 disabled:cursor-not-allowed ${userVote === -1 ? "opacity-100" : "opacity-40 hover:opacity-80"}`}>👎</button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white/90 leading-relaxed">"{caption.content}"</p>
                        <p className="text-white/25 text-xs mt-2">
                          {new Date(caption.created_datetime_utc).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!user && !loading && (
            <p className="text-center text-white/30 text-sm mt-6">Sign in with Google to vote on captions</p>
          )}
        </section>
      </main>
    </div>
  );
}
