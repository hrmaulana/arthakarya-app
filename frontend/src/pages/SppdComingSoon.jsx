import { IconPlane } from "../components/Icons.jsx";

export default function SppdComingSoon() {
  return (
    <div className="sppd-coming-soon">
      {/* Sky background */}
      <div className="sppd-sky" />

      {/* Clouds drifting */}
      <div className="cloud cloud-1" />
      <div className="cloud cloud-2" />
      <div className="cloud cloud-3" />

      {/* Airplane */}
      <div className="plane-flight">
        <div className="plane-icon-large">
          <IconPlane />
        </div>
      </div>

      {/* Contrails behind plane */}
      <div className="contrails">
        <div className="contrail" />
        <div className="contrail" />
        <div className="contrail" />
        <div className="contrail" />
        <div className="contrail" />
      </div>

      <h1>SPPD</h1>
      <p>
        Surat Perintah Perjalanan Dinas — modul pengajuan, persetujuan, dan
        pencetakan SPPD sedang dalam pengembangan. Segera hadir di Arthakarya.
      </p>
    </div>
  );
}
