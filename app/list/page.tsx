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
type FlashMap = Record<string, boolean>;

const API_BASE = "https://api.almostcrackd.ai";
const PAGE_SIZE = 20;

export default function ListPage() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [votes, setVotes] = useState<VoteMap>({});
  const [flash, setFlash] = useState<FlashMap>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [uploadStep, setUploadStep] = useState<string | null>(null);
  const [generatedCaptions, setGeneratedCaptions] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchCaptions = async (currentOffset: number, replace: boolean) => {
    const { data: captionData } = await supabase
      .from("captions")
      .select("id, content, like_count, created_datetime_utc, image_id, images(url)")
      .order("like_count", { ascending: false })
      .range(currentOffset, currentOffset + PAGE_SIZE - 1);
    const results = (captionData as unknown as Caption[]) ?? [];
    if (replace) setCaptions(results);
    else setCaptions((prev) => [...prev, ...results]);
    setHasMore(results.length === PAGE_SIZE);
    setOffset(currentOffset + results.length);
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      await fetchCaptions(0, true);
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

  const handleShowMore = async () => {
    setLoadingMore(true);
    await fetchCaptions(offset, false);
    setLoadingMore(false);
  };

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
    setFlash((prev) => ({ ...prev, [captionId]: true }));
    setTimeout(() => setFlash((prev) => ({ ...prev, [captionId]: false })), 600);
  };

  const handleImageUpload = async (file: File) => {
    if (!user) return;
    setUploadError(null);
    setGeneratedCaptions([]);
    setPreviewUrl(null);

    // Show local preview immediately
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const authHeaders = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
      setUploadStep("Getting upload URL...");
      const presignRes = await fetch(`${API_BASE}/pipeline/generate-presigned-url`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error(`Presign failed: ${await presignRes.text()}`);
      const { presignedUrl, cdnUrl } = await presignRes.json();
      setUploadStep("Uploading image...");
      const uploadRes = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      setUploadStep("Registering image...");
      const registerRes = await fetch(`${API_BASE}/pipeline/upload-image-from-url`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ imageUrl: cdnUrl, isCommonUse: false }),
      });
      if (!registerRes.ok) throw new Error(`Register failed: ${await registerRes.text()}`);
      const { imageId } = await registerRes.json();
      setUploadStep("Generating captions...");
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
    <div style={{ minHeight: "100vh", background: "#0a0a0e", color: "#f0ebe4", fontFamily: "'Georgia', serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
        @keyframes voteFlash { 0% { transform: scale(1); } 40% { transform: scale(1.5); } 100% { transform: scale(1); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .vote-flash { animation: voteFlash 0.35s cubic-bezier(.36,.07,.19,.97); }
        .fade-in { animation: fadeIn 0.4s ease forwards; }
        .card:hover { border-color: rgba(255,255,255,0.12) !important; transform: translateY(-1px); }
        .card { transition: all 0.2s ease; }
        .upload-zone:hover { border-color: rgba(255,107,53,0.5) !important; background: rgba(255,107,53,0.04) !important; }
      `}</style>

      {/* Header */}
      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1000, margin: "0 auto" }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#ff6b35", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>AlmostCrackd</div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, color: "#f0ebe4", margin: 0, lineHeight: 1 }}>Caption Rater</h1>
          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "4px 0 0" }}>Vote on the funniest captions</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {user ? (
            <>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{user.email}</span>
              <button onClick={async () => { await supabase.auth.signOut(); setUser(null); setVotes({}); }}
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "8px 16px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)", borderRadius: 100, cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}>
                Sign out
              </button>
            </>
          ) : (
            <button onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } })}
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: "10px 20px", background: "#f0ebe4", color: "#0a0a0e", borderRadius: 100, border: "none", fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
              Sign in with Google
            </button>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 32px" }}>

        {/* Upload section */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#ff6b35", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>Generate</div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, color: "#f0ebe4", margin: 0 }}>Create a Caption</h2>
          </div>

          {!user ? (
            <div style={{ border: "1.5px dashed rgba(255,255,255,0.12)", borderRadius: 16, padding: "48px 32px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🖼️</div>
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>Sign in to generate captions from your images</p>
              <button onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } })}
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: "10px 24px", background: "#ff6b35", color: "#fff", border: "none", borderRadius: 100, fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                Sign in to upload
              </button>
            </div>
          ) : (
            <div className="upload-zone"
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleImageUpload(f); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              style={{ cursor: "pointer", border: `1.5px dashed ${dragOver ? "rgba(255,107,53,0.6)" : "rgba(255,255,255,0.12)"}`, borderRadius: 16, padding: "48px 32px", textAlign: "center", background: dragOver ? "rgba(255,107,53,0.05)" : "transparent", transition: "all 0.2s" }}>
              <input ref={fileRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
              {uploadStep ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 28, height: 28, border: "2px solid rgba(255,107,53,0.3)", borderTopColor: "#ff6b35", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#ff6b35" }}>{uploadStep}</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 32 }}>🖼️</span>
                  <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Drop an image here or click to upload</p>
                  <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.2)" }}>JPEG, PNG, WEBP, GIF, HEIC supported</p>
                </div>
              )}
            </div>
          )}

          {/* Image preview + generated captions */}
          {(generatedCaptions.length > 0 || (previewUrl && uploadStep)) && (
            <div className="fade-in" style={{ marginTop: 20, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
              {previewUrl && (
                <img src={previewUrl} alt="Uploaded" style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }} />
              )}
              {generatedCaptions.length > 0 && (
                <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Generated Captions</div>
                  {generatedCaptions.map((cap, i) => (
                    <div key={i} style={{ padding: "14px 18px", borderRadius: 10, background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.15)" }}>
                      <p style={{ fontFamily: "'Georgia', serif", fontSize: 15, color: "#f0ebe4", lineHeight: 1.6, margin: 0 }}>"{cap}"</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {uploadError && (
            <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 10, background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#f87171" }}>
              {uploadError}
            </div>
          )}
        </section>

        {/* Captions feed */}
        <section>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#ff6b35", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>Leaderboard</div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, color: "#f0ebe4", margin: 0 }}>Top Captions</h2>
          </div>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
              <div style={{ width: 28, height: 28, border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "rgba(255,255,255,0.6)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {captions.map((caption, idx) => {
                  const userVote = votes[caption.id];
                  const imageUrl = caption.images?.url ?? null;
                  const isFlashing = flash[caption.id];
                  return (
                    <div key={caption.id} className="card fade-in" style={{ borderRadius: 16, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      {imageUrl && (
                        <img src={imageUrl} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block" }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      )}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 20, padding: "20px 24px" }}>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: "rgba(255,255,255,0.06)", flexShrink: 0, width: 36, textAlign: "center", lineHeight: 1 }}>
                          {idx + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: "'Georgia', serif", fontSize: 16, color: "rgba(255,255,255,0.88)", lineHeight: 1.65, margin: "0 0 8px" }}>"{caption.content}"</p>
                          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.2)", margin: 0 }}>
                            {new Date(caption.created_datetime_utc).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                          </p>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <button onClick={() => handleVote(caption.id, 1)} disabled={!user}
                            title={user ? "Upvote" : "Sign in to vote"}
                            className={isFlashing && userVote === 1 ? "vote-flash" : ""}
                            style={{ fontSize: 20, background: "none", border: "none", cursor: user ? "pointer" : "not-allowed", opacity: userVote === 1 ? 1 : 0.35, transition: "opacity 0.15s", padding: "4px" }}>
                            👍
                          </button>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: isFlashing ? "#fff" : caption.like_count > 0 ? "#34d399" : caption.like_count < 0 ? "#f87171" : "rgba(255,255,255,0.3)", transition: "color 0.2s", minWidth: 28, textAlign: "center" }}>
                            {caption.like_count}
                          </span>
                          <button onClick={() => handleVote(caption.id, -1)} disabled={!user}
                            title={user ? "Downvote" : "Sign in to vote"}
                            className={isFlashing && userVote === -1 ? "vote-flash" : ""}
                            style={{ fontSize: 20, background: "none", border: "none", cursor: user ? "pointer" : "not-allowed", opacity: userVote === -1 ? 1 : 0.35, transition: "opacity 0.15s", padding: "4px" }}>
                            👎
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {hasMore && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
                  <button onClick={handleShowMore} disabled={loadingMore}
                    style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: "12px 28px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)", borderRadius: 100, cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 8 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.35)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}>
                    {loadingMore ? (
                      <><span style={{ width: 12, height: 12, border: "1.5px solid rgba(255,255,255,0.2)", borderTopColor: "rgba(255,255,255,0.7)", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} /> Loading...</>
                    ) : "Show more captions"}
                  </button>
                </div>
              )}

              {!hasMore && captions.length > 0 && (
                <p style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 32, letterSpacing: "0.1em" }}>
                  ALL {captions.length} CAPTIONS SHOWN
                </p>
              )}
            </>
          )}

          {!user && !loading && (
            <p style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "rgba(255,255,255,0.2)", marginTop: 24 }}>
              Sign in with Google to vote on captions
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
