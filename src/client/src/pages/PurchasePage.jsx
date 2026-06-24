import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, DotLoading, Toast } from 'antd-mobile';
import { getWonTaskDetail } from '../utils/api';
import { formatBeijingDateTime } from '../utils/datetime';

const SELLER_RATING_URL = 'https://auctions.yahoo.co.jp/jp/show/rating?auc_user_id=EtiXFFxD1RicEcSG7jwNhNU4i2Dt2';
const YAHOO_LOGO_URL = '/yahoo-assets/auctions_r_34_2x.png';
const YAHOO_USER_ICON_URL = '/yahoo-assets/user_64_00.png';

function formatJPY(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `${amount.toLocaleString('ja-JP')}円` : '-';
}

function formatWonDate(item) {
  const source = item?.won_time_text || item?.won_at || item?.updated_at || '';
  if (!source) return '-';
  if (item?.won_time_text) return item.won_time_text;
  return formatBeijingDateTime(source);
}

function getTitle(item) {
  return item?.product_title || `商品 ${item?.product_id || ''}`.trim();
}

function hashString(value) {
  return String(value || '').split('').reduce((hash, char) => {
    return ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }, 2166136261);
}

function buildSellerDisplay(productId) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let seed = hashString(productId);
  let prefix = '';
  for (let i = 0; i < 3; i += 1) {
    let index = seed % letters.length;
    if (i > 0) {
      const previousIndex = letters.indexOf(prefix[i - 1]);
      if (index === previousIndex + 1 || index === previousIndex - 1) {
        index = (index + 7) % letters.length;
      }
      if (index === previousIndex) {
        index = (index + 11) % letters.length;
      }
    }
    prefix += letters[index];
    seed = Math.floor(seed / letters.length) ^ hashString(`${productId}-${i}`);
  }
  const rating = 1000 + (hashString(`${productId}-rating`) % 15001);
  return { name: `${prefix}********`, rating };
}

function stopAction(event) {
  event.preventDefault();
  event.stopPropagation();
}

function ButtonLike({ className = 'libBtnGrayS', children }) {
  return (
    <span className={className} aria-disabled="true" role="presentation">
      <span>{children}</span>
    </span>
  );
}

function ProductSummary({ item }) {
  const title = getTitle(item);
  const seller = buildSellerDisplay(item?.product_id);
  return (
    <div className="acMdItemInfo libItemInfo">
      <dl className="ptsItmInfoDl">
        <dt className="decItmPhoto">
          {item?.product_image_url ? (
            <img src={item.product_image_url} alt="" width="50" height="50" />
          ) : (
            <span className="decNoPhoto" />
          )}
        </dt>
        <dd className="decItmName">{title}</dd>
        <dd className="decPrice">
          <span className="decQunt">落札数量： 1</span>落札価格： {formatJPY(item?.final_price)}
        </dd>
        <dd className="decMDT">終了日時： {formatWonDate(item)}</dd>
        <dd className="decItmID">
          <p>オークションID： {item?.product_id || '-'}</p>
        </dd>
        <dd className="decSellerID">
          <p>
            出品者： {seller.name}（
            <a href={SELLER_RATING_URL} onClick={stopAction}>{seller.rating}</a>
            ）
          </p>
        </dd>
      </dl>
      <p className="ptsItmPgBtn">
        <ButtonLike className="libBtnGrayS">商品ページへ</ButtonLike>
      </p>
    </div>
  );
}

function StatusImage() {
  return (
    <div className="acMdStatusImage">
      <ul className="acMdStatusImage__status acMdStatusImage__status--st04 acMdStatusImage__status--current04 acMdStatusImage__status--end acMdStatusImage__status--complete">
        <li className="acMdStatusImage__statusText">取引情報</li>
        <li className="acMdStatusImage__statusText">お支払い</li>
        <li className="acMdStatusImage__statusText">発送連絡</li>
        <li className="acMdStatusImage__statusText">受取連絡</li>
      </ul>
      <ul className="acMdStatusImage__charge">
        <li className="acMdStatusImage__chargeText" />
        <li className="acMdStatusImage__chargeText" />
        <li className="acMdStatusImage__chargeText" />
        <li className="acMdStatusImage__chargeText" />
      </ul>
    </div>
  );
}

function TradeInfo() {
  return (
    <div className="acMdTradeInfo">
      <div className="libJsExpand libGrdVr libJsExpandClose">
        <div className="libTitleH2TxtVr"><h2>取引情報</h2></div>
        <div className="libLeadText">
          <p className="libJsExpandToggleBtn">
            <span className="decIcoArw" />
            <a href="#trade-info" onClick={stopAction}>お届け情報・お支払い情報などを確認する</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function TradeMessage({ item }) {
  const seller = buildSellerDisplay(item?.product_id);
  return (
    <>
      <div className="acMdMsgForm" id="messageComment">
        <div className="libTitleH2TxtVr"><h2>取引メッセージ</h2></div>
        <div className="libLeadText">
          <p>取引で困ったことなどがあったら、出品者に質問してみよう！</p>
        </div>
        <div className="untMsgForm" id="msgForm">
          <div id="area1" className="decTxtArea">
            <textarea id="textarea" placeholder="メッセージを入力してください" readOnly onClick={stopAction} />
          </div>
          <div className="decSmtBtn">
            <input type="hidden" id="aid" value={item?.product_id || ''} readOnly />
            <input type="hidden" id="partnerDisplayName" value={seller.name} readOnly />
            <input id="submitButton" className="libBtnGrayM" type="submit" value="送信する" disabled />
          </div>
        </div>
      </div>
      <div className="acMdMsgForm">
        <div className="untPreMsg" id="messagelist">
          <dl className="ptsPartner">
            <dt>
              <p id="sellerid">{seller.name}</p>
              <span className="decTime">{formatWonDate(item)}</span>
            </dt>
            <dd id="body">
              お世話になります。<br /><br />
              発送完了から数日以内に到着する予定となっております。<br />
              商品に何らかの問題がございましたら取引ナビよりお知らせ願います。
            </dd>
          </dl>
        </div>
      </div>
    </>
  );
}

function PurchasePageStyles() {
  return (
    <style>{`
      .purchaseYahooReplica { --yahoo-content-width:634px; background:#fff; color:#333; font:13px/1.35 Arial, Helvetica, sans-serif; min-height:100vh; }
      .purchaseYahooReplica a { color:#0645d2; text-decoration:none; cursor:default; }
      .purchaseYahooReplica table { border-collapse:collapse; width:100%; }
      .purchaseYahooReplica input:disabled, .purchaseYahooReplica textarea[readonly] { cursor:default; opacity:1; color:#333; }
      .purchaseYahooReplica .offLeft { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
      .purchaseYahooReplica #acWrHead, .purchaseYahooReplica #acWrContents { width:var(--yahoo-content-width); max-width:100%; margin:0 auto; }
      .purchaseYahooReplica #header { padding-top:6px; min-height:168px; }
      .purchaseYahooReplica #TEMPLA_MH_VDOM { display:block; min-height:88px; }
      .purchaseYahooReplica #msthd { font-size:11px; }
      .purchaseYahooReplica #mhHeadLine { display:flex; align-items:center; justify-content:space-between; height:22px; }
      .purchaseYahooReplica #mhd_uhd_pc .txt { margin:0; }
      .purchaseYahooReplica #mhSearchLink { display:flex; align-items:center; gap:8px; color:#0645d2; }
      .purchaseYahooReplica #mhLinkBox { display:flex; gap:8px; list-style:none; padding:0; margin:0; }
      .purchaseYahooReplica #mhSearch { display:flex; align-items:center; }
      .purchaseYahooReplica #mhSearchInput { width:128px; height:17px; padding:0 4px; border:1px solid #bfc7d2; font-size:11px; box-sizing:border-box; }
      .purchaseYahooReplica #mhSearchBtn { width:22px; height:18px; border:1px solid #336fd6; background:#336fd6; color:#fff; font-size:0; position:relative; }
      .purchaseYahooReplica #mhSearchBtn:after { content:""; position:absolute; left:7px; top:4px; width:6px; height:6px; border:2px solid #fff; border-radius:50%; }
      .purchaseYahooReplica #mhSearchBtn:before { content:""; position:absolute; left:14px; top:11px; width:6px; height:2px; background:#fff; transform:rotate(45deg); }
      .purchaseYahooReplica #mhMain { display:flex; align-items:flex-start; gap:14px; height:56px; padding-top:7px; }
      .purchaseYahooReplica #mhServiceLogo { width:162px; padding-left:0; }
      .purchaseYahooReplica #mhLogo img { width:160px; height:auto; object-fit:contain; }
      .purchaseYahooReplica #mhInfos { display:flex; align-items:flex-start; min-width:330px; }
      .purchaseYahooReplica #mhUserIcon { display:flex; align-items:flex-start; gap:6px; }
      .purchaseYahooReplica #mhUserIconImg { width:24px; height:24px; border-radius:50%; margin-top:5px; }
      .purchaseYahooReplica #mhLoginUser { min-width:52px; padding-top:3px; }
      .purchaseYahooReplica #mhUserName { font-weight:bold; color:#0645d2; }
      .purchaseYahooReplica #mhPointArea { padding-top:2px; line-height:1.55; color:#0645d2; }
      .purchaseYahooReplica .mhPaypay { color:#0645d2; }
      .purchaseYahooReplica .msthdNewAucIcon { display:inline-block; min-height:18px; line-height:1.5; color:#0645d2; position:relative; }
      .purchaseYahooReplica .modAdSpn { margin:0 auto 6px; height:68px; text-align:center; color:#003b8f; font-size:22px; font-weight:bold; line-height:1.15; position:relative; }
      .purchaseYahooReplica .modAdSpn strong { color:#e60012; }
      .purchaseYahooReplica .mockTPointButton { display:inline-flex; align-items:center; justify-content:center; min-width:170px; height:18px; margin-top:5px; background:#f20; color:#fff; font-size:13px; font-weight:bold; }
      .purchaseYahooReplica #libPointNavi { padding:0 0 7px; text-align:right; font-size:11px; }
      .purchaseYahooReplica #libPointNavi ul { list-style:none; margin:0; padding:0; }
      .purchaseYahooReplica #libPointNavi li { display:inline-block; margin-left:14px; }
      .purchaseYahooReplica .yjSeparation { border:0; border-top:1px solid #e4e4e4; margin:10px 0; }
      .purchaseYahooReplica #contents { width:var(--yahoo-content-width); margin:0 auto; }
      .purchaseYahooReplica #acConHeader { display:flex; justify-content:space-between; align-items:flex-start; margin-top:10px; }
      .purchaseYahooReplica .acMdHeadH1 h1 { font-size:20px; font-weight:normal; margin:0 0 14px; }
      .purchaseYahooReplica .decGuideLink { font-size:12px; }
      .purchaseYahooReplica .decIconBeginer { display:inline-block; width:9px; height:11px; margin-right:3px; background:#86bd1d; vertical-align:-1px; }
      .purchaseYahooReplica .acMdItemInfo { position:relative; width:286px; min-height:66px; padding-right:78px; font-size:11px; }
      .purchaseYahooReplica .ptsItmInfoDl { margin:0; padding:0 0 0 58px; min-height:52px; }
      .purchaseYahooReplica .ptsItmInfoDl dt, .purchaseYahooReplica .ptsItmInfoDl dd { margin:0; padding:0; }
      .purchaseYahooReplica .decItmPhoto { position:absolute; left:0; top:0; }
      .purchaseYahooReplica .decItmPhoto img, .purchaseYahooReplica .decNoPhoto { display:block; width:50px; height:50px; border:1px solid #cfcfcf; object-fit:cover; background:#eee; }
      .purchaseYahooReplica .decItmName { width:205px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#111; }
      .purchaseYahooReplica .decQunt { margin-right:8px; }
      .purchaseYahooReplica .decSellerID p, .purchaseYahooReplica .decItmID p { margin:0; }
      .purchaseYahooReplica .ptsItmPgBtn { position:absolute; right:0; top:22px; margin:0; }
      .purchaseYahooReplica .libBtnGrayS, .purchaseYahooReplica .libBtnGrayM, .purchaseYahooReplica .libBtnBlueL { display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; border-radius:2px; border:1px solid #aaa; background:linear-gradient(#fff,#e8e8e8); color:#333; font-size:12px; min-height:24px; padding:4px 14px; text-decoration:none; box-shadow:inset 0 1px #fff; }
      .purchaseYahooReplica .libBtnBlueL { min-width:168px; min-height:32px; border-color:#79aeca; background:#dff3ff; color:#064b7a; }
      .purchaseYahooReplica .libBtnGrayM { min-height:28px; }
      .purchaseYahooReplica .acMdTradeNotice .ptsBoxOk { border:1px solid #49b647; background:#dcffd8; color:#008000; font-weight:bold; margin:20px 0; padding:7px 10px; }
      .purchaseYahooReplica .ptsBoxOk p { margin:0; }
      .purchaseYahooReplica .ptsBoxOk span { display:inline-block; width:15px; height:10px; border-left:4px solid #3bba00; border-bottom:4px solid #3bba00; transform:rotate(-45deg); margin-right:8px; vertical-align:2px; }
      .purchaseYahooReplica .acMdStatusImage { width:360px; margin:42px auto 24px; }
      .purchaseYahooReplica .acMdStatusImage__status, .purchaseYahooReplica .acMdStatusImage__charge { display:flex; justify-content:space-between; list-style:none; margin:0; padding:0; position:relative; }
      .purchaseYahooReplica .acMdStatusImage__status { color:#8a8a8a; font-size:12px; margin-bottom:8px; }
      .purchaseYahooReplica .acMdStatusImage__charge:before { content:""; position:absolute; top:9px; left:28px; right:36px; height:2px; background:#63c7e8; }
      .purchaseYahooReplica .acMdStatusImage__chargeText { width:18px; height:18px; border-radius:50%; border:2px solid #4bbce9; background:#fff; box-sizing:border-box; position:relative; }
      .purchaseYahooReplica .acMdStatusImage__chargeText:after { content:""; position:absolute; width:6px; height:6px; border-radius:50%; background:#84d4ef; left:4px; top:4px; }
      .purchaseYahooReplica .acMdStatusCmt { margin-bottom:20px; }
      .purchaseYahooReplica .elAdvnc .fntB { color:#ff6a00; font-weight:bold; margin:0 0 24px; }
      .purchaseYahooReplica .acMdTradeBtn { text-align:center; }
      .purchaseYahooReplica .Notice { border:1px solid #d7d7d7; margin:30px 0; padding:10px; font-size:12px; }
      .purchaseYahooReplica .u-textBold { font-weight:bold; margin:0 0 10px; }
      .purchaseYahooReplica .alignC { text-align:center; }
      .purchaseYahooReplica .libTitleH2TxtVr { background:#f6f4ec; padding:7px 8px; }
      .purchaseYahooReplica .libTitleH2TxtVr h2 { margin:0; font-size:14px; }
      .purchaseYahooReplica .libLeadText { padding:10px 8px; font-size:12px; }
      .purchaseYahooReplica .libLeadText p { margin:0; }
      .purchaseYahooReplica .decIcoArw { display:inline-block; width:17px; height:16px; border:1px solid #aaa; background:#eee; margin-right:8px; vertical-align:-4px; }
      .purchaseYahooReplica .decIcoArw:after { content:"▶"; display:block; font-size:10px; color:#555; line-height:16px; text-align:center; }
      .purchaseYahooReplica .libJsExpandBody { padding:0 10px 10px; }
      .purchaseYahooReplica .libTableCnfTop { margin-bottom:12px; }
      .purchaseYahooReplica .libTableCnfTop > table > tbody > tr > th { width:120px; vertical-align:top; text-align:left; color:#555; font-weight:bold; }
      .purchaseYahooReplica .decInTblCel { vertical-align:top; }
      .purchaseYahooReplica .libTableCnf { border:1px solid #ddd; background:#fff; }
      .purchaseYahooReplica .libTableCnf th { width:110px; padding:7px; border-right:1px solid #eee; border-bottom:1px solid #eee; background:#fafafa; text-align:left; color:#555; }
      .purchaseYahooReplica .libTableCnf td { padding:7px; border-bottom:1px solid #eee; }
      .purchaseYahooReplica .decTradeTime { margin-left:8px; color:#777; }
      .purchaseYahooReplica .acMdMsgForm { margin-top:22px; }
      .purchaseYahooReplica .untMsgForm { display:flex; gap:8px; align-items:flex-start; padding:10px 6px 0; }
      .purchaseYahooReplica .decTxtArea { flex:1; }
      .purchaseYahooReplica textarea { width:100%; height:34px; box-sizing:border-box; resize:none; border:1px solid #999; font-size:12px; }
      .purchaseYahooReplica .decSmtBtn { width:116px; text-align:right; }
      .purchaseYahooReplica .untPreMsg { margin-top:16px; border-top:1px solid #e1e1e1; }
      .purchaseYahooReplica .ptsPartner { margin:12px 0; padding:0; font-size:12px; }
      .purchaseYahooReplica .ptsPartner dt { display:flex; gap:10px; color:#555; }
      .purchaseYahooReplica .ptsPartner dt p { margin:0; font-weight:bold; }
      .purchaseYahooReplica .ptsPartner dd { margin:8px 0 0; padding:10px; border:1px solid #ddd; background:#fafafa; }
      @media (max-width: 820px) {
        .purchaseYahooReplica #acWrHead, .purchaseYahooReplica #acWrContents, .purchaseYahooReplica #contents { width:100%; }
        .purchaseYahooReplica #contents { padding:0 8px; box-sizing:border-box; }
        .purchaseYahooReplica #header { min-height:0; }
        .purchaseYahooReplica #mhHeadLine { height:auto; align-items:flex-start; gap:8px; flex-wrap:wrap; }
        .purchaseYahooReplica #mhSearchLink { flex-wrap:wrap; justify-content:flex-start; }
        .purchaseYahooReplica #mhMain { height:auto; gap:10px; flex-wrap:wrap; }
        .purchaseYahooReplica #mhServiceLogo { width:auto; }
        .purchaseYahooReplica #mhLogo img { max-width:160px; }
        .purchaseYahooReplica #mhInfos { min-width:0; }
        .purchaseYahooReplica #acConHeader { display:block; }
        .purchaseYahooReplica .acMdItemInfo { width:auto; margin-top:18px; padding-right:0; }
        .purchaseYahooReplica .ptsItmInfoDl { padding-left:58px; min-height:54px; }
        .purchaseYahooReplica .decItmName { width:auto; max-width:100%; }
        .purchaseYahooReplica .ptsItmPgBtn { position:static; margin:8px 0 0 58px; }
        .purchaseYahooReplica .modAdSpn { font-size:20px; height:auto; padding:8px 0; }
        .purchaseYahooReplica .mockMiniYahoo { position:static; display:block; margin-bottom:3px; }
        .purchaseYahooReplica .acMdStatusImage { width:100%; max-width:360px; }
        .purchaseYahooReplica .libTableCnfTop > table > tbody > tr > th,
        .purchaseYahooReplica .libTableCnfTop > table > tbody > tr > td,
        .purchaseYahooReplica .libTableCnf th,
        .purchaseYahooReplica .libTableCnf td { display:block; width:auto; box-sizing:border-box; }
        .purchaseYahooReplica .libTableCnf th { border-right:0; }
        .purchaseYahooReplica .untMsgForm { display:block; }
        .purchaseYahooReplica .decSmtBtn { width:auto; margin-top:8px; text-align:left; }
      }
      @media (max-width: 420px) {
        .purchaseYahooReplica .modAdSpn { font-size:17px; height:auto; padding-bottom:8px; }
        .purchaseYahooReplica #mhInfos { display:block; }
        .purchaseYahooReplica #mhPointArea { padding-left:42px; }
        .purchaseYahooReplica .acMdStatusImage__status { font-size:11px; }
        .purchaseYahooReplica .acMdItemInfo { font-size:10px; }
        .purchaseYahooReplica .ptsItmPgBtn { margin-left:0; }
      }
    `}</style>
  );
}

export default function PurchasePage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [item, setItem] = useState(location.state?.item || null);
  const [loading, setLoading] = useState(!location.state?.item);

  const loadItem = useCallback(() => {
    if (!id) return;
    setLoading(true);
    getWonTaskDetail(id)
      .then(res => setItem(res.data?.data || null))
      .catch(error => {
        Toast.show({ content: error.response?.data?.error || '购买页面加载失败' });
        setItem(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadItem();
  }, [loadItem]);

  const itemTitle = useMemo(() => getTitle(item), [item]);

  if (loading) {
    return (
      <div style={{ padding: 36, textAlign: 'center', color: '#333' }}>
        <DotLoading /> 加载中
      </div>
    );
  }

  if (!item) {
    return (
      <div style={{ padding: 24 }}>
        <Button size="small" onClick={() => navigate('/won')}>返回落札商品</Button>
        <div style={{ marginTop: 16, color: '#666' }}>未找到对应的购买页面。</div>
      </div>
    );
  }

  return (
    <div className="purchaseYahooReplica yj950-1">
      <PurchasePageStyles />
      <div id="acWrHead">
        <div id="header">
          <span className="yjGuid"><a name="yjPagetop" id="yjPagetop" /></span>
          <div id="mh_login_done" style={{ display: 'none' }}>
            https://contact.auctions.yahoo.co.jp/buyer/top?aid={item.product_id || ''}
          </div>
          <div id="TEMPLA_MH_VDOM">
            <div id="msthd">
              <div id="mhHeadLine">
                <div id="mhd_uhd_pc">
                  <div className="compo">
                    <p className="txt">
                      <a href="#emergency" onClick={stopAction}>【緊急支援】フィリピン地震 緊急支援募金にご協力ください</a>
                    </p>
                  </div>
                </div>
                <div id="mhSearchLink">
                  <ul id="mhLinkBox">
                    <li id="mhLinkYtop"><a href="#ytop" onClick={stopAction}>Yahoo! JAPAN</a></li>
                    <li id="mhLinkHelp"><a href="#help" id="mhHelpLink" onClick={stopAction}>ヘルプ</a></li>
                  </ul>
                  <div id="mhSearchBox">
                    <form onSubmit={stopAction}>
                      <div id="mhSearch">
                        <label id="msthdslb" htmlFor="mhSearchInput" className="offLeft">キーワード：</label>
                        <input id="mhSearchInput" type="text" name="p" value="" placeholder="ウェブ検索" readOnly />
                        <button id="mhSearchBtn" type="submit" title="検索">検索</button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
              <div id="mhMain">
                <div id="mhServiceLogo">
                  <a href="#auctions" id="mhLogo" onClick={stopAction}>
                    <img
                      src={YAHOO_LOGO_URL}
                      alt="Yahoo!オークション"
                      width="238"
                      height="34"
                    />
                  </a>
                </div>
                <div id="mhInfos">
                  <div id="mhUserIcon">
                    <a id="mhUserIconLink" href="#profile" onClick={stopAction}>
                      <img
                        src={YAHOO_USER_ICON_URL}
                        alt="ユーザーアイコン"
                        width="36"
                        height="36"
                        id="mhUserIconImg"
                      />
                    </a>
                    <div id="mhLoginUser">
                      <div className="mhUserInfo">
                        <a href="#user" id="mhUserName" onClick={stopAction}>ワタルル</a>
                      </div>
                      <div className="mhUserInfo"><span id="mhdPremiumPc" /></div>
                    </div>
                    <div id="mhPointArea">
                      <div className="mhUserInfo">
                        <a id="mhPaypayBalance" className="mhPaypay" href="#paypay" onClick={stopAction}>0pt</a>
                        <span>（<a id="mhPaypayRegisterExtraLink" className="mhPaypay" href="#paypay-register" onClick={stopAction}>利用登録</a>）</span>
                      </div>
                      <div className="mhUserInfo">
                        <span id="mhd_text_pc">
                          <a href="#coupon" id="msthdPrLink" className="msthdNewAucIcon" onClick={stopAction}>【おトク】10%OFFクーポンあります</a>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="modAdSpn js-modal-cover" id="fnaviSpn">
            Tポイントが <strong>Yahoo! JAPAN</strong> で貯まる! 使える!
            <div><span className="mockTPointButton">➜➜ 利用手続きはこちら</span></div>
          </div>

          <div id="libPointNavi" className="cf">
            <div className="ptsPoint" />
            <div className="ptsNavi">
              <ul>
                <li><a href="#myauc" onClick={stopAction}>マイオク</a></li>
                <li><a href="#sell" onClick={stopAction}>出品</a></li>
                <li><a href="#options" onClick={stopAction}>オプション/設定</a></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <hr className="yjSeparation" />

      <div id="acWrContents">
        <div id="contents">
          <div id="yjContentsBody">
            <div id="yjMain" className="cf">
              <div id="acConHeader" className="cf">
                <div className="acMdHeadH1 libTitleH1">
                  <h1>取引ナビ</h1>
                  <div className="decGuideLink mT20">
                    <a href="#guide" onClick={stopAction}><span className="decIconBeginer" />使い方ガイド</a>
                  </div>
                </div>
                <ProductSummary item={item} />
              </div>

              <div className="acMdTradeNotice libTopMessage">
                <div className="ptsBoxOk mB20">
                  <p><span />すべての取引が完了しました！またYahoo!オークションをご利用ください。</p>
                </div>
              </div>

              <StatusImage />

              <div className="acMdStatusCmt">
                <div className="elAdvnc">
                  <p className="fntB">出品者に受け取り連絡をしました。</p>
                  <div className="acMdTradeBtn">
                    <ButtonLike className="libBtnBlueL">出品者を評価する</ButtonLike>
                  </div>
                </div>
              </div>

              <div className="Notice u-marginV30 u-padding10">
                <p className="u-marginB10 u-textBold">何かお困りですか？</p>
                <p className="fntN">
                  商品が届かない、届いた商品に問題があったなど、こちらの商品の取引でお困りの場合には、以下から問い合わせができます。
                </p>
                <div className="alignC mT10"><a href="#report" onClick={stopAction}>お問い合わせをする</a></div>
              </div>

              <TradeInfo item={{ ...item, product_title: itemTitle }} />
              <TradeMessage item={item} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
