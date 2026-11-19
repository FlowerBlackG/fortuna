# SPDX-License-Identifier: MulanPSL-2.0
from dataclasses import asdict, dataclass
from flask import Response, jsonify

type ApiResponse = tuple[Response, int]


@dataclass
class IResponse:
    code: int
    msg: str
    data: object = None

    def response(self) -> ApiResponse:
        return jsonify(asdict(self)), 200

    @staticmethod
    def ok(data: object = None, msg: str = "OK") -> ApiResponse:
        return IResponse(200, msg, data).response()

    @staticmethod
    def error(code: int, msg: str) -> ApiResponse:
        return IResponse(code, msg).response()


class ApiError(Exception):
    def __init__(self, code: int, msg: str) -> None:
        super().__init__(msg)
        self.code = code
        self.msg = msg
