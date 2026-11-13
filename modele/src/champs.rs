//! (a venir)
use ipc2581::py::Json;
pub struct ErreurChamps { pub message: String, pub conseil: String }
pub fn inventaire(_d: &std::path::Path) -> Result<Json, ErreurChamps> { Ok(Json::Nul) }
pub fn serie(_d: &std::path::Path, _c: &str, _a: &str, _i: Option<i64>, _p: usize, _t: usize) -> Result<Json, ErreurChamps> { Ok(Json::Nul) }
