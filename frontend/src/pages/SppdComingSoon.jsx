import { IconPlane } from "../components/Icons.jsx";

export default function SppdComingSoon() {
  return (
    <div className="sppd-coming-soon">
      {/* Sky background */}
      <div className="sppd-sky" />

      {/* Cloud layers — parallax depths */}
      <div className="cloud cloud-a" />
      <div className="cloud cloud-b" />
      <div className="cloud cloud-c" />
      <div className="cloud cloud-d" />
      <div className="cloud cloud-e" />

      {/* Airplane — full flight path with contrails inside */}
      <div className="plane-flight">
        <div className="plane-contrails">
          <span /><span /><span /><span /><span />
        </div>
        <div className="plane-icon-large">
          <IconPlane />
        </div>
      </div>

      <h1>SPPD</h1>
      <p>
        Surat Perintah Perjalanan Dinas — modul pengajuan, persetujuan, dan
        pencetakan SPPD sedang dalam pengembangan. Segera hadir di Arthakarya.
      </p>
    </div>
  );
}
