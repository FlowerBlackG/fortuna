# SPDX-License-Identifier: MulanPSL-2.0
from dataclasses import asdict, dataclass
from typing import Any

from flask import jsonify


@dataclass
class IResponse:
    code: int
    msg: str
    data: Any = None

    def response(self):
        return jsonify(asdict(self)), 200

    @staticmethod
    def ok(data=None, msg="OK"):
        return IResponse(200, msg, data).response()

    @staticmethod
    def error(code, msg):
        return IResponse(code, msg).response()


class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg
