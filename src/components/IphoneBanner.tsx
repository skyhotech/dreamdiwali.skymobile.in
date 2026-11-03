import iphone from "../assets/brand/iphone15.webp";
// On every customer screen: the contest prize. Photo: Ka Kit Pang, public
// domain, via Wikimedia Commons ("Apple iPhone 15.jpeg").
export function IphoneBanner() {
  return (
    <div className="iphone-banner" role="note">
      <img src={iphone} alt="iPhone 15" width={56} height={108} />
      <div>
        <b>A chance to win an iPhone 15!</b>
        <span>Post a video review Reel with @skymobileandelectronics</span>
      </div>
    </div>
  );
}
