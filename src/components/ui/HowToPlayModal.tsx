import { X } from 'lucide-react';

interface HowToPlayModalProps {
  onClose: () => void;
}

export function HowToPlayModal({ onClose }: HowToPlayModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="pixel-panel-gold w-full max-w-2xl max-h-[88dvh] overflow-y-auto p-6 text-[#f5efe0]">
        <div className="flex items-center justify-between border-b border-amber-500/25 pb-3 mb-4">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-amber-300">
            Cara Bermain TREASUREBOUND
          </h2>
          <button
            onClick={onClose}
            className="pixel-btn p-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-sm leading-relaxed text-slate-200">
          <section>
            <h3 className="font-semibold text-amber-300 mb-1">
              1. Jenjang Pendidikan & Ekspedisi 10 Pemain
            </h3>
            <p>
              Host room memilih tingkat soal <strong>SD</strong>, <strong>SMP</strong>, atau{' '}
              <strong>SMA</strong> sebelum pertandingan dimulai. Hingga <strong>10 penjelajah</strong>{' '}
              berlomba di pulau besar berisi 6 zona: Desa Penjelajah, Hutan Ajaib, Rawa Terlupakan,
              Reruntuhan Kuno, Gua Kristal, dan Kuil Tersembunyi.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-amber-300 mb-1">
              2. Sistem Progresi Harta 4 Tahap
            </h3>
            <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm text-slate-200">
              <li>
                <strong>Tahap 1 — Peti Kecil (5 Peti):</strong> Jawab rangkaian soal pada setiap
                Small Chest (+10 poin/soal, +25 bonus selesai) untuk mengumpulkan 5 Fragmen Kode.
              </li>
              <li>
                <strong>Tahap 2 — Segel Large Treasure:</strong> Bawa ke-5 fragmen kode ke Pelataran
                Kuil Timur Laut dan buka segel kombinasi (+50 poin).
              </li>
              <li>
                <strong>Tahap 3 — Ujian Large Treasure:</strong> Taklukkan 3 soal tingkat lanjut
                (+20 poin/soal) untuk membuka akses ruang terdalam.
              </li>
              <li>
                <strong>Tahap 4 — Klaim Secret Treasure:</strong> Buka gerbang kuil dalam dan klaim
                Secret Treasure (+100 poin) untuk langsung memenangkan pertandingan!
              </li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold text-amber-300 mb-1">
              3. Rintangan Lingkungan, Tuas & Kunci Rahasia
            </h3>
            <p className="text-xs sm:text-sm">
              Jawab teka-teki Gerbang Batu (+15 poin) untuk membuka jalan masuk, aktifkan Tuas
              Jembatan Rawa & Lorong Kristal untuk jalur pintas, atau temukan Kunci Emas di Hutan
              Utara untuk membuka Peti Rahasia Gua Kristal.
            </p>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="bg-slate-900/80 border border-slate-700 p-3">
              <div className="font-semibold text-amber-200 mb-1">Kontrol Desktop</div>
              <ul className="space-y-1 text-xs text-slate-300">
                <li>WASD / Panah — Bergerak</li>
                <li>Kursor Mouse — Arahkan Magic Orb</li>
                <li>E / Klik Kiri — Serang Magic Orb</li>
                <li>F / Spasi — Interaksi Peti, Tuas, Gerbang, NPC</li>
                <li>1 — Makan Apel (+25 HP)</li>
                <li>I / Tab — Jurnal & Tas · Esc — Jeda</li>
              </ul>
            </div>
            <div className="bg-slate-900/80 border border-slate-700 p-3">
              <div className="font-semibold text-amber-200 mb-1">Kontrol Mobile Landscape</div>
              <ul className="space-y-1 text-xs text-slate-300">
                <li>Joystick Kiri — Gerak 360°</li>
                <li>Pad Bidik Kanan — Arahkan Magic Orb</li>
                <li>Tombol Serang — Tembakkan Magic Orb</li>
                <li>Tombol Interaksi — Buka peti / gerbang / tuas</li>
                <li>Tombol Apel — Pulihkan +25 HP</li>
              </ul>
            </div>
          </section>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="pixel-btn px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm cursor-pointer whitespace-nowrap"
          >
            Mengerti
          </button>
        </div>
      </div>
    </div>
  );
}
