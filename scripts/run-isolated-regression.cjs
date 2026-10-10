const fs=require('fs');
const path=require('path');
const os=require('os');
const {spawnSync}=require('child_process');
const Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gdaipai-regression-'));
const filename=path.join(dir,'test.sqlite');
const database=new Database(filename);
database.exec(fs.readFileSync(path.join(root,'src/db/init.sql'),'utf8'));
database.close();
const result=spawnSync(process.execPath,process.argv[2] ? [process.argv[2],...process.argv.slice(3)] : ['scripts/run-regression.js'],{cwd:root,env:{...process.env,DATABASE_URL:`sqlite:${filename}`,NODE_ENV:'test',GDAIPAI_ISOLATED_TESTS:'1'},stdio:'inherit'});
// Remove only files inside this freshly created, verified temporary directory.
fs.rmSync(dir,{recursive:true,force:true});
if(result.error) throw result.error;
process.exitCode=result.status || 0;
