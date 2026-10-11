import { useEffect, useRef, useState } from "react";

export default function CameraCapture({
    onCapture, onClose,
}: { onCapture: (file: File) => void; onClose: () => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!navigator.mediaDevices?.getUserMedia) {
                setError("Live camera needs a secure (https) connection."); return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                    audio: false,
                });
                if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
            } catch {
                setError("Could not open the camera. Please allow camera permission.");
            }
        })();
        return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()); };
    }, []);

    const snap = () => {
        const v = videoRef.current;
        if (!v || !v.videoWidth) return;
        const c = document.createElement("canvas");
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d")!.drawImage(v, 0, 0);
        c.toBlob(b => {
            if (b) { onCapture(new File([b], "capture.jpg", { type: "image/jpeg" })); onClose(); }
        }, "image/jpeg", 0.92);
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label="Camera">
            {error ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-white">
                    <p>{error}</p>
                    <label className="rounded-xl bg-white px-6 py-3 font-semibold text-black">
                        Take a photo instead
                        <input type="file" accept="image/*" capture="environment" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) { onCapture(f); onClose(); } }} />
                    </label>
                </div>
            ) : (
                <video ref={videoRef} playsInline muted autoPlay className="min-h-0 flex-1 object-contain" />
            )}
            <div className="flex items-center justify-center gap-4 p-4">
                <button onClick={onClose} className="rounded-xl bg-white/20 px-5 py-3 text-white">Cancel</button>
                {!error && (
                    <button onClick={snap} aria-label="Capture photo"
                        className="h-16 w-16 rounded-full border-4 border-white bg-white/90" />
                )}
            </div>
        </div>
    );
}